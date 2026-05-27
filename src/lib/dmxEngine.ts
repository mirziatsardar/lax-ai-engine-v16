import { ActiveFixture, MovementMode, ColorMode, PhaseMode } from '../types';
import * as THREE from 'three';

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
  
  public globalPrism: boolean | 'auto' = 'auto';
  public prism1Type: 'beam' | '10pt' | '64pt' | '128pt' = '64pt';
  public prism1RotSpeed: 'stop' | 'fast_r' | 'slow_r' | 'slow_l' | 'fast_l' | 'auto' = 'auto';
  
  public planModeActive = false;
  // fixtureId (universe_addr) -> override config
  public planOverrides: Record<string, { active: boolean, pan: number, tilt: number, frost: boolean, color?: number, gobo?: number }> = {};
  
  public roomSize: [number, number, number] = [10, 5, 10];
  private fixturePosCache: Record<string, any> = {};
  private lastCacheTime = 0;

  private fixtureStates: Record<string, { pan16: number, tilt16: number, dimmer: number }> = {};
  private goboIdx = 0;
  private colorIdx = 0;

  constructor() {
    this.refresh3DPositions();
  }

  private refresh3DPositions() {
    try {
      const sp = localStorage.getItem('lax_fixture_pos_3d');
      if (sp) this.fixturePosCache = JSON.parse(sp);
      const sr = localStorage.getItem('lax_room_size_3d');
      if (sr) this.roomSize = JSON.parse(sr);
    } catch(e) {}
    this.lastCacheTime = Date.now();
  }

  private getCenterAim(fixtureId: string): { pan: number, tilt: number } {
    const pos = this.fixturePosCache[fixtureId];
    if (!pos) return { pan: 32768, tilt: 32768 };

    // Target is somewhat to the center of the room, maybe slightly lifted
    let dx = 0 - pos.x;
    let dy = (this.roomSize[1] * 0.2) - pos.y;
    let dz = 0 - pos.z;

    if (pos.rx || pos.ry || pos.rz) {
       const euler = new THREE.Euler(pos.rx || 0, pos.ry || 0, pos.rz || 0, 'XYZ');
       const vec = new THREE.Vector3(dx, dy, dz);
       vec.applyEuler(new THREE.Euler(-euler.x, -euler.y, -euler.z, 'ZYX')); // Inverse rotation
       dx = vec.x;
       dy = vec.y;
       dz = vec.z;
    }

    const distSum = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (distSum === 0) return { pan: 32768, tilt: 32768 };

    // Default base is -Y
    let baseBeta = Math.acos(-dy / distSum); 
    let alphaA = Math.atan2(-dz, dx);
    // Unmapped:
    const panNorm = (alphaA / (Math.PI * 3)) + 0.5;
    const tiltNorm = baseBeta / (Math.PI * 1.5);

    return { 
      pan: Math.max(0, Math.min(65535, Math.floor(panNorm * 65535))), 
      tilt: Math.max(0, Math.min(65535, Math.floor(tiltNorm * 65535))) 
    };
  }

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
    if (Date.now() - this.lastCacheTime > 2000) {
      this.refresh3DPositions();
    }
    const universes: Record<number, number[]> = {};
    
    const effectiveEnergy = isSilence ? 0 : energy;
    const effectiveBassHit = isSilence ? false : bassHit;
    const effectiveTrebleHit = isSilence ? false : trebleHit;

    // limit impact of high energy on slow songs by keeping base speed lower and maxing out softly
    let dynamicSpeed = 1.0;
    const isChillMode = effectiveEnergy < 0.05;
    if (isChillMode) {
      dynamicSpeed = 0.5;
    } else {
      // Soften the speed scale so it doesn't whip around crazily
      dynamicSpeed = 0.8 + Math.min(effectiveEnergy * 1.5, 1.5);
    }
    if (climaxMode) dynamicSpeed *= 1.2;
    
    if (!isSilence) {
      this.currentPhase += dynamicSpeed * delta;
      this.patternTimer += delta;
    }
    
    if (this.strobeTimer > 0) this.strobeTimer -= delta;
    
    // Treble Logic -> Gobo Change (打搽声换图案)
    // Add time-based debounce to prevent too rapid gobo changing
    if (effectiveTrebleHit && this.patternTimer > 0.2) {
      this.goboIdx = (this.goboIdx + 1) % 15; // Cycle through more patterns
      this.patternTimer = 0;
    }

    // Bass Logic -> Color Change & Strobe Trigger
    if (effectiveBassHit) {
      this.beatCounter++;
      this.colorIdx++;
      
      // Keep flash duration short for punchy sync
      this.strobeTimer = 0.15; 
      
      // Random AI mode switches effects based on climax
      const switchThreshold = climaxMode ? 4 : 8; 
      
      if (this.isRandomMode && this.beatCounter % switchThreshold === 0) {
        this.currentMove = (["sweep", "wave", "circle", "symmetry", "fan", "cross"] as MovementMode[])[Math.floor(Math.random() * 6)];
        // Add random mode variations for color and dimmer so it doesn't look monotonous
        this.currentColor = (["sync", "rainbow", "chase"] as AdvancedColorMode[])[Math.floor(Math.random() * 3)];
        this.currentDimmerMode = (["sync", "pulse", "stack"] as DimmerMode[])[Math.floor(Math.random() * 3)];
        this.currentPhaseMode = (["uniform", "odd_even_offset", "gradient"] as PhaseMode[])[Math.floor(Math.random() * 3)];
      }
    }

    const typeCounts: Record<string, number> = {};
    fixtures.forEach(f => typeCounts[f.type] = (typeCounts[f.type] || 0) + 1);
    const typeIds: Record<string, number> = {};

    // Standard DMX Spot Color wheel mapping and matching RGB
    // Assuming typical 14-slot color wheel
    const colorPalette = [
      { rgb: [255, 255, 255], dmx: 0 },   // White
      { rgb: [255, 0, 0], dmx: 9 },       // Red
      { rgb: [255, 255, 0], dmx: 18 },    // Yellow
      { rgb: [0, 0, 255], dmx: 27 },      // Blue
      { rgb: [0, 255, 0], dmx: 36 },      // Green
      { rgb: [255, 0, 255], dmx: 45 },    // Pink/Magenta
      { rgb: [255, 90, 0], dmx: 54 },     // Orange
      { rgb: [0, 255, 255], dmx: 63 },    // Cyan
      { rgb: [255, 255, 128], dmx: 72 },  // White-Yellow
      { rgb: [255, 60, 0], dmx: 81 },     // Red-Orange
    ];

    fixtures.forEach((fix, globalIdx) => {
      if (!universes[fix.universe]) universes[fix.universe] = new Array(512).fill(0);
      const buffer = universes[fix.universe];
      const fixId = `${fix.universe}_${fix.addr}`;
      if (!this.fixtureStates[fixId]) this.fixtureStates[fixId] = { pan16: 32768, tilt16: 32768, dimmer: 0 };
      
      typeIds[fix.type] = (typeIds[fix.type] || 0) + 1;
      const idx = typeIds[fix.type];
      const totalOfType = typeCounts[fix.type];
      const totalFixtures = fixtures.length;
      const state = this.fixtureStates[fixId];
      
      // Phase Offset
      let phaseOffset = 0;
      if (this.currentPhaseMode === "gradient") phaseOffset = (idx / totalOfType) * Math.PI * 2;
      else if (this.currentPhaseMode === "odd_even_offset") phaseOffset = idx % 2 === 0 ? Math.PI : 0;

      // Motion Logic from Python
      const centerAim = this.getCenterAim(fix.id);
      let targetPan16 = centerAim.pan;
      let targetTilt16 = centerAim.tilt;
      const ampP = isChillMode ? 10000 : 20000;
      const ampT = isChillMode ? 6000 : 16000;

      if (!isSilence) {
        switch(this.currentMove) {
          case "sweep":
            targetPan16 = centerAim.pan + ampP * Math.sin(this.currentPhase);
            targetTilt16 = centerAim.tilt + ampT * Math.cos(this.currentPhase * 1.5);
            break;
          case "wave":
            targetPan16 = centerAim.pan + ampP * Math.sin(this.currentPhase + phaseOffset);
            targetTilt16 = centerAim.tilt + ampT * Math.cos(this.currentPhase + phaseOffset);
            break;
          case "circle":
            targetPan16 = centerAim.pan + ampP * Math.cos(this.currentPhase + phaseOffset);
            targetTilt16 = centerAim.tilt + ampT * Math.sin(this.currentPhase + phaseOffset);
            break;
          case "symmetry":
            const direction = idx <= totalOfType / 2 ? 1 : -1;
            targetPan16 = centerAim.pan + direction * ampP * Math.sin(this.currentPhase + phaseOffset / 2);
            targetTilt16 = centerAim.tilt + ampT * Math.cos(this.currentPhase);
            break;
          case "cross":
            targetPan16 = centerAim.pan + ampP * Math.sin(this.currentPhase + (idx % 2 === 0 ? Math.PI : 0));
            targetTilt16 = centerAim.tilt + ampT * Math.cos(this.currentPhase);
            break;
          case "fan":
            const spreadCount = totalOfType - 1 || 1;
            const spread = 40000 / spreadCount;
            targetPan16 = centerAim.pan - 20000 + (idx - 1) * (totalOfType > 1 ? spread : 0);
            targetTilt16 = centerAim.tilt + ampT * Math.cos(this.currentPhase + phaseOffset);
            break;
        }
      }

      const lerpSpeed = isChillMode ? 0.08 : 0.2;
      state.pan16 += (targetPan16 - state.pan16) * lerpSpeed;
      state.tilt16 += (targetTilt16 - state.tilt16) * lerpSpeed;

      // Color Logic Sync across ALL fixtures
      let r = 0, g = 0, b = 0;
      let colorWheelIndex = 0;
      
      if (!isSilence) {
        if (this.currentColor === "sync") {
          const c = colorPalette[this.colorIdx % colorPalette.length];
          [r, g, b] = c.rgb;
          colorWheelIndex = c.dmx;
        } else if (this.currentColor === "rainbow") {
          // Use globalIdx for rainbow so all fixtures of all types flow together
          const hue = (this.currentPhase * 0.2 + globalIdx / totalFixtures) % 1;
          [r, g, b] = this.hsvToRgb(hue, 1, 1);
          colorWheelIndex = Math.floor(hue * 130); // Spread hue evenly across DMX color wheel 0-130
        } else if (this.currentColor === "chase") {
          const cId = (this.beatCounter + globalIdx) % colorPalette.length;
          const c = colorPalette[cId];
          [r, g, b] = c.rgb;
          colorWheelIndex = c.dmx;
        }
      }

      // Dimmer Logic 
      let targetDimmer = 255;
      if (!isSilence) {
        if (!settings.ovrShutterLock) {
          // Unlocked: Flash exactly on the beat! (strobe)
          targetDimmer = (this.strobeTimer > 0) ? 255 : 0;
          state.dimmer = targetDimmer; // Instant jump, no lerp for punchy flash
        } else {
          // Locked: Follow Dimmer Mode
          if (this.currentDimmerMode === "pulse") {
            targetDimmer = Math.floor(Math.abs(Math.sin(this.currentPhase * 1.5 + phaseOffset)) * 255);
          } else if (this.currentDimmerMode === "stack") {
            const activeCount = Math.floor((this.currentPhase * 2) % (totalOfType + 2));
            targetDimmer = idx <= activeCount ? 255 : 0;
          }
        }
      } else {
        targetDimmer = 0;
      }
      
      // Lerp dimmer if we are not in hard flash mode
      if (settings.ovrShutterLock || isSilence) {
        state.dimmer += (targetDimmer - state.dimmer) * 0.2;
      }
      
      let finalDimmer = Math.max(0, Math.min(settings.ovrDimmer, Math.floor(state.dimmer)));

      // Shutter Logic - Apply BEAM295W Strobe logic
      let finalShutter = 255;
      let spotShutterStatus = 255; // 255 = on, 0 = off, 100 = fast strobe
      if (isSilence) {
        spotShutterStatus = 0;
      } else if (!settings.ovrShutterLock) {
        spotShutterStatus = (this.strobeTimer > 0) ? 100 : 0;
      } else {
        spotShutterStatus = 255;
      }

      const baseShutter = fix.type === 'par' || fix.type === 'wash' 
        ? (settings.ovrShutterPW ?? 0) 
        : spotShutterStatus;

      finalShutter = baseShutter;

      const prismActive = this.globalPrism === 'auto' 
        ? (climaxMode || (energy > 0.8 && trebleHit))
        : this.globalPrism;
      
      // BEAM295W Gobo: 0-97 scale per 6 values = static gobos (16 gobos max)
      // We map this.goboIdx (which cycles) to the static gobo wheels
      let finalGobo = prismActive ? 0 : ((this.goboIdx % 16) * 6);
      
      // BEAM 295W Prism1: 0-63 beam, 64-127 10-pt, 128-191 64-pt, 192-255 128-pt
      let finalPrism1 = 0;
      if (prismActive) {
         if (this.globalPrism !== 'auto' && this.globalPrism === true) {
            // When manually ON, respect the manual prism type. When 'auto', default to 64pt.
            switch(this.prism1Type) {
               case 'beam': finalPrism1 = 0; break;
               case '10pt': finalPrism1 = 95; break;
               case '64pt': finalPrism1 = 160; break;
               case '128pt': finalPrism1 = 225; break;
            }
         } else {
            // Auto mode -> defaults to 64-pt for visual effect
            finalPrism1 = 160;
         }
      }
      
      // BEAM 295W Prism1Rot: 0-127 stop, 128-165 fast R, 166-191 slow R, 192-200 slow L, 200-255 fast L
      let finalPrism1Rot = 0;
      if (prismActive && !isChillMode) {
         const rotVal = (speed: typeof this.prism1RotSpeed) => {
            switch(speed) {
               case 'stop': return 0;
               case 'fast_r': return 145;
               case 'slow_r': return 180;
               case 'slow_l': return 195;
               case 'fast_l': return 230;
               default: return 0;
            }
         };
         
         if (this.globalPrism === true && this.prism1RotSpeed !== 'auto') {
            finalPrism1Rot = rotVal(this.prism1RotSpeed);
         } else {
            // Auto mapping
            finalPrism1Rot = Math.sin(this.currentPhase) > 0 ? 145 : 230; 
         }
      }

      let finalPrism2 = prismActive && climaxMode ? 255 : 0;
      
      // Focus: 0-127 beam, 128-191 frost, 192-255 color disk
      let finalFrost = settings.ovrFrost;
      let finalFocus = finalFrost > 127 ? 150 : (prismActive ? 64 : 64);
      let finalZoom = climaxMode ? 255 : 128;
      let isPureWhite = (r === 255 && g === 255 && b === 255);
      
      // === PLAN MODE OVERRIDES ===
      if (this.planOverrides[fix.id] && this.planOverrides[fix.id].active) {
        const ovr = this.planOverrides[fix.id];
        // Instantly snap to the target position
        state.pan16 = ovr.pan;
        state.tilt16 = ovr.tilt;
        finalDimmer = 255;
        finalShutter = 255;
        
        if (ovr.color !== undefined) {
           colorWheelIndex = ovr.color;
           isPureWhite = false;
        } else {
           r = 255; g = 255; b = 255; colorWheelIndex = 0; isPureWhite = true;
        }

        finalFrost = ovr.frost ? 255 : 0;
        finalFocus = ovr.frost ? 150 : 64;
        
        finalPrism2 = 0;
        finalGobo = ovr.gobo !== undefined ? ovr.gobo * 6 : 0;
        finalZoom = ovr.frost ? 0 : 128;
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
      
      setCh("White", isPureWhite ? 255 : 0); 
      
      setCh("Frost", finalFrost);
      setCh("Speed", settings.ovrPtSpeed);
      
      const cWheel = Math.floor(colorWheelIndex);
      setCh("Color", cWheel);
      setCh("Color2", cWheel);
      setCh("ColorMacro", 0); // 0-160 single color mode
      
      setCh("Gobo", finalGobo);
      setCh("GoboRot", 255); // 128-255 static gobo
      setCh("Prism1", finalPrism1);
      setCh("Prism1Rot", finalPrism1Rot);
      setCh("Prism2", finalPrism2);
      
      setCh("Focus", finalFocus);
      setCh("Zoom", finalZoom);

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
