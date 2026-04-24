import { ActiveFixture, MovementMode, ColorMode, PhaseMode } from '../types';

export class DMXEngine {
  private currentPhase = 0;
  private beatCounter = 0;
  private strobeTimer = 0;
  
  public currentMove: MovementMode = "circle";
  public currentColor: ColorMode = "rainbow";
  public currentPhaseMode: PhaseMode = "gradient";
  
  private fixtureStates: Record<string, { pan16: number, tilt16: number, dimmer: number }> = {};

  constructor() {}

  update(
    fixtures: ActiveFixture[], 
    energy: number, 
    bassHit: boolean, 
    climaxMode: boolean, 
    delta: number,
    settings: {
      ovrDimmer: number;
      ovrPtSpeed: number;
      ovrShutterLock: boolean;
      ovrFrost: number;
    }
  ): Record<number, number[]> {
    const universes: Record<number, number[]> = {};
    
    const dynamicSpeed = (energy < 0.03 ? 0.5 : (1.5 + energy * 10.0)) * (climaxMode ? 1.8 : 1.0);
    this.currentPhase += dynamicSpeed * delta;
    
    if (this.strobeTimer > 0) this.strobeTimer -= delta;
    
    if (bassHit) {
      this.beatCounter++;
      this.strobeTimer = 0.15;
      
      const switchThreshold = climaxMode ? 2 : 8;
      if (this.beatCounter % switchThreshold === 0) {
        this.currentMove = (["sweep", "wave", "circle", "symmetry", "fan", "cross"] as MovementMode[])[Math.floor(Math.random() * 6)];
        this.currentColor = (["sync", "rainbow", "chase"] as ColorMode[])[Math.floor(Math.random() * 3)];
        this.currentPhaseMode = (["uniform", "odd_even_offset", "gradient"] as PhaseMode[])[Math.floor(Math.random() * 3)];
      }
    }

    const typeCounts: Record<string, number> = {};
    fixtures.forEach(f => typeCounts[f.type] = (typeCounts[f.type] || 0) + 1);
    const typeIds: Record<string, number> = {};

    fixtures.forEach(fix => {
      if (!universes[fix.universe]) universes[fix.universe] = new Array(512).fill(0);
      const buffer = universes[fix.universe];
      const fixId = `${fix.universe}_${fix.addr}`;
      if (!this.fixtureStates[fixId]) this.fixtureStates[fixId] = { pan16: 32768, tilt16: 32768, dimmer: 0 };
      
      typeIds[fix.type] = (typeIds[fix.type] || 0) + 1;
      const idx = typeIds[fix.type];
      const totalOfType = typeCounts[fix.type];
      
      let phaseOffset = 0;
      if (this.currentPhaseMode === "gradient") phaseOffset = (idx / totalOfType) * Math.PI * 2;
      else if (this.currentPhaseMode === "odd_even_offset") phaseOffset = idx % 2 === 0 ? Math.PI : 0;

      // Motion
      let targetPan16 = 32768;
      let targetTilt16 = 32768;
      const ampP = energy < 0.03 ? 10000 : 25000;
      const ampT = energy < 0.03 ? 6000 : 18000;

      if (this.currentMove === "circle") {
        targetPan16 = 32768 + ampP * Math.cos(this.currentPhase + phaseOffset);
        targetTilt16 = 32768 + ampT * Math.sin(this.currentPhase + phaseOffset);
      } else if (this.currentMove === "wave") {
        targetPan16 = 32768 + ampP * Math.sin(this.currentPhase + phaseOffset);
        targetTilt16 = 32768 + ampT * Math.cos(this.currentPhase + phaseOffset);
      } else if (this.currentMove === "sweep") {
        targetPan16 = 32768 + ampP * Math.sin(this.currentPhase);
        targetTilt16 = 32768 + ampT * Math.cos(this.currentPhase * 1.5);
      }
      // Add more as needed...

      const state = this.fixtureStates[fixId];
      const lerp = energy < 0.03 ? 0.08 : 0.25;
      state.pan16 += (targetPan16 - state.pan16) * lerp;
      state.tilt16 += (targetTilt16 - state.tilt16) * lerp;

      // Dimmer
      state.dimmer += (255 - state.dimmer) * 0.25;
      const finalDimmer = Math.min(settings.ovrDimmer, Math.floor(state.dimmer));

      // Shutter
      let finalShutter = 255;
      if (settings.ovrShutterLock) {
        finalShutter = fix.type === 'par' ? 0 : 255;
      } else {
        finalShutter = this.strobeTimer > 0 ? (fix.type === 'par' ? 255 : 200) : (fix.type === 'par' ? 0 : 255);
      }

      // Color
      let r = 0, g = 0, b = 0;
      if (this.currentColor === "rainbow") {
        const hue = (this.currentPhase * 0.1 + idx / totalOfType) % 1;
        [r, g, b] = this.hsvToRgb(hue, 1, 1);
      } else {
        const colors = [[255,0,0], [0,255,0], [0,0,255], [255,255,0], [255,0,255], [0,255,255]];
        const c = colors[this.beatCounter % colors.length];
        r = c[0]; g = c[1]; b = c[2];
      }

      // Map to buffer
      const setCh = (name: string, val: number) => {
        const ch = fix.channels[name];
        if (ch) buffer[fix.addr - 1 + ch - 1] = Math.max(0, Math.min(255, val));
      };

      setCh("Dimmer", finalDimmer);
      setCh("Pan", state.pan16 >> 8);
      setCh("PanFine", state.pan16 & 0xFF);
      setCh("Tilt", state.tilt16 >> 8);
      setCh("TiltFine", state.tilt16 & 0xFF);
      setCh("Shutter", finalShutter);
      setCh("Red", r);
      setCh("Green", g);
      setCh("Blue", b);
      setCh("White", climaxMode ? 255 : 0);
      setCh("Frost", settings.ovrFrost);
      setCh("Speed", settings.ovrPtSpeed);
      
      // Multi-feature logic
      setCh("Prism1", energy > 0.1 ? 255 : 0);
      setCh("Prism1Rot", Math.floor(127 + 127 * Math.sin(this.currentPhase)));
      setCh("Prism2", climaxMode ? 255 : 0);
      setCh("Focus", 128);
      setCh("Zoom", climaxMode ? 255 : 128);
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
