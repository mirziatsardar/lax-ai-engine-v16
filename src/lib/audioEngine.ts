export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  
  public bassHit = false;
  public trebleHit = false;
  public climaxMode = false;
  public energy = 0;
  
  private lastBassTime = 0;
  private lastTrebleTime = 0;
  private bassHistory: number[] = [];
  private trebleHistory: number[] = [];

  constructor() {}

  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);
      
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
    } catch (err) {
      console.error("Microphone Access Error:", err);
      throw err;
    }
  }

  process() {
    if (!this.analyser || !this.dataArray) return;
    
    this.analyser.getByteFrequencyData(this.dataArray);
    
    // Calculate Energy
    let total = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      total += this.dataArray[i];
    }
    this.energy = total / this.dataArray.length / 255;
    
    const now = Date.now();
    
    // BASS (60Hz - 150Hz)
    // Bin = (freq * fftSize) / sampleRate
    // e.g. (60 * 2048) / 44100 = ~2.8 -> Bin 3
    // (150 * 2048) / 44100 = ~6.9 -> Bin 7
    const bassBins = this.dataArray.slice(3, 8);
    const bassEnergy = Array.from(bassBins).reduce((a, b) => a + b, 0) / bassBins.length;
    
    this.bassHistory.push(bassEnergy);
    if (this.bassHistory.length > 30) this.bassHistory.shift();
    const avgBass = this.bassHistory.reduce((a, b) => a + b, 0) / this.bassHistory.length;
    
    if (bassEnergy > avgBass * 3.0 && bassEnergy > 50 && now - this.lastBassTime > 300) {
      this.bassHit = true;
      this.lastBassTime = now;
    } else {
      this.bassHit = false;
    }
    
    // TREBLE (2kHz - 8kHz)
    // (2000 * 2048) / 44100 = ~92
    // (8000 * 2048) / 44100 = ~371
    const trebleBins = this.dataArray.slice(92, 371);
    const trebleEnergy = Math.max(...Array.from(trebleBins));
    
    this.trebleHistory.push(trebleEnergy);
    if (this.trebleHistory.length > 20) this.trebleHistory.shift();
    const avgTreble = this.trebleHistory.reduce((a, b) => a + b, 0) / this.trebleHistory.length;
    
    if (trebleEnergy > avgTreble * 1.6 && trebleEnergy > 10 && now - this.lastTrebleTime > 150) {
      this.trebleHit = true;
      this.lastTrebleTime = now;
    } else {
      this.trebleHit = false;
    }
    
    // CLIMAX DETECTION
    const activeBands = Array.from(this.dataArray.slice(10, 300)).filter(v => v > 100).length;
    this.climaxMode = (activeBands > 120 && this.energy > 0.15);
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
