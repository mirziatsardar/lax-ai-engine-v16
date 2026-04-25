import { FixtureDefinition } from '../types';

export const MASTER_FIXTURES: Record<string, FixtureDefinition> = {
  "WWY - 16CH295 (295W 光束灯/三合一)": {
    type: "spot", 
    channels: {"Pan": 1, "Tilt": 2, "PanFine": 3, "TiltFine": 4, "Speed": 5, "Frost": 6, "Shutter": 7, "Dimmer": 8, "Color": 9, "Gobo": 10, "Prism1": 11, "Prism2": 12, "Prism1Rot": 13, "Color2": 14, "Focus": 15, "Control": 16}
  },
  "WWY - 18ke8ch (LED 帕灯 RGBW 模式)": {
    type: "par", 
    channels: {"Dimmer": 1, "Red": 2, "Green": 3, "Blue": 4, "White": 5, "Shutter": 6, "Effect": 7, "EffectWheel": 8}
  },
  "Clay Paky Mythos (百变神话 全能型混合灯)": {
    type: "spot", 
    channels: {"Red": 1, "Green": 2, "Blue": 3, "Color": 4, "Color2": 5, "Color3": 6, "Shutter": 7, "Dimmer": 8, "DimmerFine": 9, "Gobo": 10, "Frost": 18, "Zoom": 19, "Focus": 20, "Pan": 23, "Tilt": 24, "PanFine": 25, "TiltFine": 26, "Control": 29}
  },
  "WWY - Laser FB4 (内置 FB4 系统全彩激光灯)": {
    type: "laser", 
    channels: {"Mode": 1, "Page": 2, "Cue": 3, "Speed": 4, "Dimmer": 5, "Zoom": 6, "ScaleX": 7, "ScaleY": 8, "RotateZ": 9, "PosX": 10, "PosY": 11, "Visible": 12, "ScanRate": 13, "PlayMode": 14}
  },
  "LZC - LED RGB [Tiger Touch] (LED 三色帕灯)": {
    type: "par", 
    channels: {"Dimmer": 1, "Red": 2, "Green": 3, "Blue": 4, "Shutter": 5, "Effect": 6, "Speed": 7}
  },
  "XY - 19K-16CH [Tiger Touch] (19颗 LED 调焦染色灯)": {
    type: "wash", 
    channels: {"Pan": 1, "Tilt": 2, "Speed": 3, "Dimmer": 4, "Red": 5, "Green": 6, "Blue": 7, "White": 8, "Shutter": 9, "Zoom": 10, "Effect": 11, "EffectSpeed": 12, "PanFine": 13, "TiltFine": 14, "Control": 15}
  },
  "WWY - 3rgbw (4合1 LED 帕灯)": {
    type: "par", 
    channels: {"Red": 1, "Green": 2, "Blue": 3, "White": 4, "Color": 5, "Dimmer": 6, "Shutter": 7, "Iris": 8}
  },
  "BEAM295W [Tiger Touch] (295W 光束摇头灯)": {
    type: "spot", 
    channels: {"Pan": 1, "Tilt": 2, "PanFine": 3, "TiltFine": 4, "Speed": 5, "Frost": 6, "Shutter": 7, "Dimmer": 8, "Color": 9, "ColorMacro": 10, "Gobo": 11, "GoboRot": 12, "Focus": 13, "Prism1": 14, "Prism1Rot": 15, "Control": 16}
  }
};
