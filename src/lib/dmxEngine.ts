import { ActiveFixture, MovementMode, ColorMode, PhaseMode } from '../types';

export type DimmerMode = "sync" | "pulse" | "stack";
export type AdvancedColorMode = ColorMode | "chase";

export class DMXEngine {
  private currentPhase = 0;
  private beatCounter = 0;
  private strobeTimer = 0;
  private patternTimer = 0;
  
  public currentMove: MovementMode = "circle";
  public currentColor: AdvancedColorMode = "rainbow";
  public currentDimmerMode: DimmerMode = "sync";
  public currentPhaseMode: PhaseMode = "gradient";
  public isRandomMode = true;
  
  private fixtureStates: Record<string, { pan16: number, tilt16: number, dimmer: number }> = {};
  private goboIdx = 0;
  private colorIdx = 0;

  constructor() {}

  update(
    fixtures: ActiveFixture[], 
    energy: number, 
    bassHit: boolean, 
    trebleHit: boolean,
    climaxMode: boolean, 
    delta: number,
    settings: {
      ovrDimmer: number;
      ovrPtSpeed: number;
      ovrShutterLock: boolean;
      ovrFrost: number;
      ovrShutterPW?: number;
      ovrShutterSpot?: number;
    },
    isSilence: boolean = false
  ): Record<number, number[]> {
    const universes: Record<number, number[]> = {};
    
    const effectiveEnergy = isSilence ? 0 : energy;
    const effectiveBassHit = isSilence ? false : bassHit;
    const effectiveTrebleHit = isSilence ? false : trebleHit;

    // Python Logic: Dynamic Speed
    // dynamic_speed = 0.5 if is_chill_mode else (1.5 + ambient_energy * 10.0)
    const isChillMode = effectiveEnergy < 0.03;
    let dynamicSpeed = isChillMode ? 0.5 : (1.5 + effectiveEnergy * 10.0);
    if (climaxMode) dynamicSpeed *= 1.8;
    
    if (!isSilence) {
      this.currentPhase += dynamicSpeed * delta;
      this.patternTimer += delta; // In python it doesn't seem to scale with climax for pure timer
    }
    
    if (this.strobeTimer > 0) this.strobeTimer -= delta;
    
    // Treble Logic -> Gobo Change
    if (effectiveTrebleHit) {
      this.goboIdx = (this.goboIdx + 1) % 10; // Python says % 6, but we have more gobos usually
    }

    // Bass Logic -> Color Change & Strobe Trigger
    if (effectiveBassHit) {
      this.beatCounter++;
      this.colorIdx = (this.colorIdx + 1) % 8;
      this.strobeTimer = 0.15; // 0.15s strobe life from Python
      
      const switchThreshold = climaxMode ? 2 : 8; // Python switches patterns every 8 (normal) or 2 (climax) beats
      
      if (this.isRandomMode && this.beatCounter % switchThreshold === 0) {
        this.currentMove = (["sweep", "wave", "circle", "symmetry", "fan", "cross"] as MovementMode[])[Math.floor(Math.random() * 6)];
        this.currentColor = (["sync", "rainbow", "chase"] as AdvancedColorMode[])[Math.floor(Math.random() * 3)];
        this.currentDimmerMode = (["sync", "pulse", "stack"] as DimmerMode[])[Math.floor(Math.random() * 3)];
        this.currentPhaseMode = (["uniform", "odd_even_offset", "gradient"] as PhaseMode[])[Math.floor(Math.random() * 3)];
      }
    }

    const typeCounts: Record<string, number> = {};
    fixtures.forEach(f => typeCounts[f.type] = (typeCounts[f.type] || 0) + 1);
    const typeIds: Record<string, number> = {};

    const colors: [number, number, number][] = [
      [255,0,0], [0,255,0], [0,0,255], [255,255,0], 
      [255,0,255], [0,255,255], [255,128,0], [255,255,255]
    ];

    fixtures.forEach(fix => {
      if (!universes[fix.universe]) universes[fix.universe] = new Array(512).fill(0);
      const buffer = universes[fix.universe];
      const fixId = `${fix.universe}_${fix.addr}`;
      if (!this.fixtureStates[fixId]) this.fixtureStates[fixId] = { pan16: 32768, tilt16: 32768, dimmer: 0 };
      
      typeIds[fix.type] = (typeIds[fix.type] || 0) + 1;
      const idx = typeIds[fix.type];
      const totalOfType = typeCounts[fix.type];
      const state = this.fixtureStates[fixId];
      
      // Phase Offset
      let phaseOffset = 0;
      if (this.currentPhaseMode === "gradient") phaseOffset = (idx / totalOfType) * Math.PI * 2;
      else if (this.currentPhaseMode === "odd_even_offset") phaseOffset = idx % 2 === 0 ? Math.PI : 0;

      // Motion Logic from Python
      let targetPan16 = 32768;
      let targetTilt16 = 32768;
      const ampP = isChillMode ? 10000 : 30000;
      const ampT = isChillMode ? 6000 : 22000;

      if (!isSilence) {
        switch(this.currentMove) {
          case "sweep":
            targetPan16 = 32768 + ampP * Math.sin(this.currentPhase);
            targetTilt16 = 32768 + ampT * Math.cos(this.currentPhase * 1.5);
            break;
          case "wave":
            targetPan16 = 32768 + ampP * Math.sin(this.currentPhase + phaseOffset);
            targetTilt16 = 32768 + ampT * Math.cos(this.currentPhase + phaseOffset);
            break;
          case "circle":
            targetPan16 = 32768 + ampP * Math.cos(this.currentPhase + phaseOffset);
            targetTilt16 = 32768 + ampT * Math.sin(this.currentPhase + phaseOffset);
            break;
          case "symmetry":
            const direction = idx <= totalOfType / 2 ? 1 : -1;
            targetPan16 = 32768 + direction * ampP * Math.sin(this.currentPhase + phaseOffset / 2);
            targetTilt16 = 32768 + ampT * Math.cos(this.currentPhase);
            break;
          case "cross":
            targetPan16 = 32768 + ampP * Math.sin(this.currentPhase + (idx % 2 === 0 ? Math.PI : 0));
            targetTilt16 = 32768 + ampT * Math.cos(this.currentPhase);
            break;
          case "fan":
            const spreadCount = totalOfType - 1 || 1;
            const spread = 40000 / spreadCount;
            targetPan16 = 32768 - 20000 + (idx - 1) * (totalOfType > 1 ? spread : 0);
            targetTilt16 = 32768 + ampT * Math.cos(this.currentPhase + phaseOffset);
            break;
        }
      }

      const lerpSpeed = isChillMode ? 0.08 : 0.3;
      state.pan16 += (targetPan16 - state.pan16) * lerpSpeed;
      state.tilt16 += (targetTilt16 - state.tilt16) * lerpSpeed;

      // Color Logic from Python
      let r = 0, g = 0, b = 0;
      if (!isSilence) {
        if (this.currentColor === "sync") {
          [r, g, b] = colors[this.colorIdx % colors.length];
        } else if (this.currentColor === "rainbow") {
          const hue = (this.currentPhase * 0.2 + idx / totalOfType) % 1;
          [r, g, b] = this.hsvToRgb(hue, 1, 1);
        } else if (this.currentColor === "chase") {
          const cId = (this.beatCounter + idx) % colors.length;
          [r, g, b] = colors[cId];
        }
      }

      // Dimmer Logic from Python
      let targetDimmer = 255;
      if (!isSilence) {
        if (this.currentDimmerMode === "pulse") {
          targetDimmer = Math.floor(Math.abs(Math.sin(this.currentPhase * 1.5 + phaseOffset)) * 255);
        } else if (this.currentDimmerMode === "stack") {
          const activeCount = Math.floor((this.currentPhase * 2) % (totalOfType + 2));
          targetDimmer = idx <= activeCount ? 255 : 0;
        }
      } else {
        targetDimmer = 0;
      }
      
      state.dimmer += (targetDimmer - state.dimmer) * 0.2;
      const finalDimmer = Math.max(0, Math.min(settings.ovrDimmer, Math.floor(state.dimmer)));

      // Shutter / Strobe Logic from Python
      let finalShutter = 255;
      const baseShutter = fix.type === 'par' || fix.type === 'wash' 
        ? (settings.ovrShutterPW ?? 0) 
        : (settings.ovrShutterSpot ?? 255);
      
      const strobeShutter = fix.type === 'par' || fix.type === 'wash' ? 200 : 250;

      if (isSilence) {
        finalShutter = baseShutter;
      } else if (settings.ovrShutterLock) {
        finalShutter = baseShutter;
      } else if (this.strobeTimer > 0) {
        finalShutter = strobeShutter;
      } else {
        finalShutter = baseShutter;
      }

      // Map to buffer
      const setCh = (name: string, val: number) => {
        const ch = fix.channels[name];
        if (ch) buffer[fix.addr - 1 + ch - 1] = Math.max(0, Math.min(255, val));
      };

      setCh("Dimmer", finalDimmer);
      setCh("DimmerFine", 255);
      setCh("Pan", Math.floor(state.pan16) >> 8);
      setCh("PanFine", Math.floor(state.pan16) & 0xFF);
      setCh("Tilt", Math.floor(state.tilt16) >> 8);
      setCh("TiltFine", Math.floor(state.tilt16) & 0xFF);
      setCh("Shutter", finalShutter);
      setCh("Red", r);
      setCh("Green", g);
      setCh("Blue", b);
      setCh("White", climaxMode ? 255 : 0);
      setCh("Frost", settings.ovrFrost);
      setCh("Speed", settings.ovrPtSpeed);
      
      const cWheel = (this.colorIdx * 15) % 120;
      setCh("Color", cWheel);
      setCh("Color2", cWheel);
      setCh("Gobo", this.goboIdx * 10);
      
      setCh("Prism1", (!isChillMode && !isSilence) ? 255 : 0);
      setCh("Prism1Rot", Math.floor(127 + 127 * Math.sin(this.currentPhase)));
      setCh("Prism2", climaxMode ? 255 : 0);
      setCh("Focus", 128);
      setCh("Zoom", climaxMode ? 255 : 128);

      if (fix.type === "laser") {
        setCh("Mode", 255);
        setCh("Visible", 255);
        const laserDim = climaxMode ? 255 : 128;
        const laserZoom = climaxMode ? 255 : 100;
        setCh("Dimmer", laserDim);
        setCh("Zoom", laserZoom);
        setCh("Page", climaxMode ? 1 : 0);
        setCh("Cue", this.goboIdx * 15);
        const laserScale = 128 + Math.floor(Math.sin(this.currentPhase * 2 + phaseOffset) * 60);
        setCh("ScaleX", laserScale);
        setCh("ScaleY", laserScale);
        setCh("RotateZ", Math.floor(this.currentPhase * 40) % 255);
      }
    });

    return universes;
  }

  private hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    let r = 0, g = 0, b = 0;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)];
  }
}
