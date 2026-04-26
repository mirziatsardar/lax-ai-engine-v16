export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  private currentStream: MediaStream | null = null;
  
  public bassHit = false;
  public trebleHit = false;
  public climaxMode = false;
  public energy = 0;
  public isSilence = true;
  
  private lastBassTime = 0;
  private lastTrebleTime = 0;
  private silenceStartTime = Date.now();
  private bassHistory: number[] = [];
  private trebleHistory: number[] = [];

  // Manual Controls
  public sensitivity = 1.0;
  public threshold = 50; // 0-255 base threshold
  public bassThresholdMult = 2.0; // multiplier for adaptive
  public silenceThreshold = 0.005; // energy threshold for silence
  public silenceDelay = 1500; // ms before blackout

  constructor() {}

  public resetHistory() {
    this.bassHistory = [];
    this.trebleHistory = [];
    this.lastBassTime = 0;
    this.lastTrebleTime = 0;
  }

  async getDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  async start(deviceId?: string) {
    try {
      // Close existing
      if (this.currentStream) {
        this.currentStream.getTracks().forEach(t => t.stop());
      }
      if (this.audioContext) {
        await this.audioContext.close();
      }

      const constraints: MediaStreamConstraints = { 
        audio: deviceId ? { deviceId: { exact: deviceId } } : true 
      };
      
      this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      
      this.microphone = this.audioContext.createMediaStreamSource(this.currentStream);
      this.microphone.connect(this.analyser);
      
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
      
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    } catch (err) {
      console.error("Audio Engine Start Error:", err);
      throw err;
    }
  }

  process() {
    if (!this.analyser || !this.dataArray || !this.audioContext) return;
    if (this.audioContext.state === 'suspended') return;
    
    this.analyser.getByteFrequencyData(this.dataArray);
    
    // Calculate Energy - Only use lower half of spectrum (most music energy is < 11kHz)
    const validBins = Math.floor(this.dataArray.length / 2);
    let total = 0;
    for (let i = 0; i < validBins; i++) {
       const val = Math.min(255, this.dataArray[i] * this.sensitivity);
       total += val;
       this.dataArray[i] = val;
    }
    // Boost energy calculation so it actually scales well between 0.0 and 1.0
    this.energy = (total / validBins / 255) * 1.5; 
    
    const now = Date.now();

    // Silence Detection
    if (this.energy > this.silenceThreshold) {
      this.silenceStartTime = now;
      this.isSilence = false;
    } else {
      if (now - this.silenceStartTime > this.silenceDelay) {
        this.isSilence = true;
      }
    }
    
    // BASS (60Hz - 250Hz approx, bins 3 to 12 for 44.1k/2048)
    const bassBins = this.dataArray.slice(3, 12);
    const bassEnergy = Array.from(bassBins).reduce((a, b) => a + b, 0) / bassBins.length;
    
    this.bassHistory.push(bassEnergy);
    if (this.bassHistory.length > 30) this.bassHistory.shift(); 
    const avgBass = this.bassHistory.reduce((a, b) => a + b, 0) / this.bassHistory.length;
    
    // Hit Logic: More sensitive by requiring just a peak over the average
    const dynamicBassThreshold = Math.max(this.threshold * 0.8, avgBass * this.bassThresholdMult);
    
    // Fast cooldown 250ms for punchy bass
    if (bassEnergy > dynamicBassThreshold && bassEnergy > 30 && now - this.lastBassTime > 250) { 
      this.bassHit = true;
      this.lastBassTime = now;
    } else {
      this.bassHit = false;
    }
    
    // TREBLE (High Hats / Snares, typically bins 100 to 400)
    const trebleBins = this.dataArray.slice(150, 400);
    const trebleEnergy = Math.max(...Array.from(trebleBins));
    
    this.trebleHistory.push(trebleEnergy);
    if (this.trebleHistory.length > 20) this.trebleHistory.shift(); // Python uses 20
    const avgTreble = this.trebleHistory.reduce((a, b) => a + b, 0) / this.trebleHistory.length;
    
    // Python: treble_energy > avg_treble * 1.6 and treble_energy > 0.5
    const dynamicTrebleThreshold = Math.max(this.threshold * 0.4, avgTreble * 1.6);
    
    if (trebleEnergy > dynamicTrebleThreshold && now - this.lastTrebleTime > 150) { // Python uses 0.15s cooldown
      this.trebleHit = true;
      this.lastTrebleTime = now;
    } else {
      this.trebleHit = false;
    }
    
    // CLIMAX DETECTION from Python
    // active_bands = np.sum(fft_data[10:300] > np.mean(fft_data[10:300]) * 1.8)
    // if active_bands > 120 and audio_energy > 0.1: climax_density_flag = True
    const midFreqData = this.dataArray.slice(10, 300);
    const midAvg = Array.from(midFreqData).reduce((a, b) => a + b, 0) / midFreqData.length;
    const activeBands = Array.from(midFreqData).filter(v => v > midAvg * 1.8).length;
    this.climaxMode = (activeBands > 120 && this.energy > 0.1);
  }

  getSpectrum() {
    if (!this.dataArray) return new Uint8Array(0);
    // Return sample of 30 bands
    const bands = 30;
    const bandSize = Math.floor(this.dataArray.length / bands / 2); // only use low and mid
    const result = new Uint8Array(bands);
    for (let i = 0; i < bands; i++) {
      const slice = this.dataArray.slice(i * bandSize, (i + 1) * bandSize);
      result[i] = Array.from(slice).reduce((a, b) => a + b, 0) / slice.length;
    }
    return result;
  }
}
