export type FixtureType = 'spot' | 'par' | 'wash' | 'laser';

export interface FixtureChannels {
  [key: string]: number;
}

export interface FixtureDefinition {
  type: FixtureType;
  channels: FixtureChannels;
}

export type FixturePosition = 'Floor_Left' | 'Floor_Right' | 'Ceiling_Left' | 'Ceiling_Right' | 'Wall_Left' | 'Wall_Right' | 'Center';

export interface ActiveFixture {
  id: string;
  name: string;
  type: FixtureType;
  universe: number;
  addr: number;
  channels: FixtureChannels;
  position: FixturePosition;
}

export interface EngineState {
  is_running: boolean;
  audio_energy: number;
  is_silent: boolean;
  bass_hit: boolean;
  treble_hit: boolean;
  climax_mode: boolean;
  beat_counter: number;
}

export type MovementMode = "sweep" | "wave" | "circle" | "symmetry" | "fan" | "cross";
export type ColorMode = "sync" | "rainbow" | "chase";
export type PhaseMode = "uniform" | "odd_even_offset" | "gradient";
