/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Zap, 
  Activity, 
  Settings, 
  Box, 
  Database, 
  ChevronRight, 
  Power, 
  AlertTriangle,
  Radio,
  Monitor
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { AudioEngine } from './lib/audioEngine';
import { DMXEngine } from './lib/dmxEngine';
import { MASTER_FIXTURES } from './lib/fixtures';
import { ActiveFixture, FixturePosition } from './types';
import Spectrum from './components/Spectrum';

const BG_DARK = "#050505";
const PANEL_BG = "rgba(0, 0, 0, 0.6)";
const CYAN = "#00f2ff";
const ORANGE = "#f27d26";
const CLIMAX = "#ff0044";

const translations = {
  en: {
    engine_name: "LAX AI Engine",
    status: "Status",
    ready: "Ready",
    active: "Active",
    protocol: "Protocol",
    core: "Core",
    terminate: "TERMINATE LINK",
    engage: "ENGAGE LINK",
    navigation: "Navigation",
    neural_core: "Neural Core",
    fixture_patch: "Fixture Patch",
    engine_cfg: "Engine Cfg",
    audio_sensing: "Audio Sensing Logic",
    bass: "Bass (60Hz-150Hz)",
    treble: "Treble (2kHz-8kHz)",
    climax_mode: "Climax Mode (狂暴模式)",
    active_at_energy: "ACTIVE AT HIGH ENERGY",
    normal_op: "Normal Operation",
    awaiting_climax: "AWAITING CLIMAX THRESHOLD",
    audio_input: "Audio Input Device",
    shutter_cfg: "Shutter Configuration",
    shutter_mode: "SHUTTER MODE",
    locked: "Locked",
    unlocked: "Unlocked",
    shutter_note: "Lock: Bass only triggers color change. Unlock: 0.15s Fast Strobe sync enabled.",
    spectrum_anal: "Neural Real-time Spectrum分析",
    active_fixtures: "Active Fixtures",
    null_patch: "NULL_PATCH_VECTOR",
    interpolation: "Interpolation Engine",
    lerp_damping: "LERP Damping",
    smooth_motor: "SMOOTH MOTOR SIMULATION ACTIVE",
    matrix_patching: "Matrix Data Patching",
    host_console: "Host Console Environment",
    target_def: "Target Definition",
    density: "Density",
    universe: "Universe",
    base_addr: "Base Addr",
    position: "Physical Position",
    process_patch: "Process Vector Extraction",
    nodes: "Active Matrix Nodes",
    total: "TOTAL",
    empty_buffer: "EMPTY_DATA_BUFFER",
    purge: "[ PURGE_CORE_MEMORY ]",
    system_cfg: "System Intervention Config",
    master_dim: "Luminance Master",
    motor_damping: "Motor Damping",
    frost: "Atmospheric Frost",
    target_vector: "Output Protocol Vector",
    target_ip: "Target IP (Unicast/Multicast)",
    movement_array: "Movement Array",
    phase_offsets: "Phase Offsets",
    engine_stream: "Engine_Log_Stream",
    scanning: "Scanning",
    engaged: "Engaged",
    pos: {
      Floor_Left: "Floor L",
      Floor_Right: "Floor R",
      Ceiling_Left: "Ceil L",
      Ceiling_Right: "Ceil R",
      Wall_Left: "Wall L",
      Wall_Right: "Wall R",
      Center: "Center"
    },
    dimmer_array: "Dimmer Array",
    color_array: "Color Array",
    random_mode: "AI Random Mode",
    active_seq: "Active Sequence",
    save_patch: "Save Patch",
    import_patch: "Import Patch",
    delete_fixture: "Delete"
  },
  zh: {
    engine_name: "LAX 智能灯光引擎",
    status: "状态",
    ready: "就绪",
    active: "激活",
    protocol: "协议",
    core: "核心",
    terminate: "切断链路",
    engage: "开启链路",
    navigation: "导航导航",
    neural_core: "神经核心",
    fixture_patch: "灯具配接",
    engine_cfg: "引擎设置",
    audio_sensing: "音频感应逻辑",
    bass: "低音 (60Hz-150Hz)",
    treble: "高音 (2kHz-8kHz)",
    climax_mode: "狂暴模式 (CLIMAX)",
    active_at_energy: "能量激发中",
    normal_op: "正常运行",
    awaiting_climax: "等待能量爆发",
    audio_input: "音频输入设备",
    shutter_cfg: "快门配置",
    shutter_mode: "频闪锁定",
    locked: "锁定",
    unlocked: "解锁",
    shutter_note: "锁定：低音仅触发颜色变化。解锁：启用0.15秒同步频闪。",
    spectrum_anal: "神经实时频谱分析",
    active_fixtures: "活动灯具",
    null_patch: "无灯具配接",
    interpolation: "插值引擎",
    lerp_damping: "LERP 阻尼",
    smooth_motor: "电机平滑仿真已激活",
    matrix_patching: "矩阵数据配接",
    host_console: "主控台环境",
    target_def: "目标定义",
    density: "数量",
    universe: "网口/域",
    base_addr: "起始地址",
    position: "物理位置",
    process_patch: "执行矢量提取",
    nodes: "活动矩阵节点",
    total: "总计",
    empty_buffer: "空数据缓冲区",
    purge: "[ 清空核心内存 ]",
    system_cfg: "系统干预配置",
    master_dim: "全局亮度",
    motor_damping: "电机阻尼",
    frost: "雾化效果",
    target_vector: "输出协议矢量",
    target_ip: "目标 IP (单播/组播)",
    movement_array: "动作矩阵",
    phase_offsets: "相位偏移",
    engine_stream: "引擎日志流",
    scanning: "扫描中",
    engaged: "已连接",
    pos: {
      Floor_Left: "地面左",
      Floor_Right: "地面右",
      Ceiling_Left: "天花左",
      Ceiling_Right: "天花右",
      Wall_Left: "墙面左",
      Wall_Right: "墙面右",
      Center: "中心"
    },
    dimmer_array: "调光矩阵",
    color_array: "颜色矩阵",
    random_mode: "AI 随机切换",
    active_seq: "活动序列",
    save_patch: "保存配接",
    import_patch: "导入配接",
    delete_fixture: "删除"
  }
};

export default function App() {
  const [lang, setLang] = useState<'en' | 'zh'>('zh');
  const t = translations[lang] as any;
  const [isRunning, setIsRunning] = useState(false);
  const [fixtures, setFixtures] = useState<ActiveFixture[]>([]);
  const [logs, setLogs] = useState<string[]>(["[OK] NEURAL CORE V16.0 STABLE"]);
  const [protocol, setProtocol] = useState("Art-Net");
  const [targetIp, setTargetIp] = useState("Broadcast");
  const [spectrumData, setSpectrumData] = useState(new Uint8Array(30));
  
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  
  // Audio/DMX Engine Refs
  const audioEngine = useMemo(() => new AudioEngine(), []);
  const dmxEngine = useMemo(() => new DMXEngine(), []);
  const socketRef = useRef<Socket | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastEmitTimeRef = useRef<number>(0);
  
  // States from engine
  const [bassHit, setBassHit] = useState(false);
  const [trebleHit, setTrebleHit] = useState(false);
  const [climaxMode, setClimaxMode] = useState(false);

  // Dynamic Engine Stats
  const [engineState, setEngineState] = useState({
    move: "circle",
    color: "rainbow",
    dimmer: "sync",
    phase: "gradient",
    isRandom: true
  });

  // Settings
  const [settings, setSettings] = useState({
    ovrDimmer: 255,
    ovrPtSpeed: 0,
    ovrShutterLock: true,
    ovrFrost: 0
  });

  const [activeTab, setActiveTab] = useState<'main' | 'patch' | 'settings'>('main');

  const addLog = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 10));
  };

  useEffect(() => {
    socketRef.current = io();
    
    socketRef.current.on("activity_log", (msg: string) => {
      setLogs(prev => [msg, ...prev].slice(0, 5));
    });

    // Load from local storage
    const saved = localStorage.getItem('lax_patch');
    if (saved) {
      try {
        setFixtures(JSON.parse(saved));
      } catch(e) {}
    }

    // Get audio devices
    audioEngine.getDevices().then(devices => {
      setAudioDevices(devices);
      if (devices.length > 0) setSelectedDeviceId(devices[0].deviceId);
    });

    return () => { socketRef.current?.disconnect(); };
  }, []);

  // Sync engine state to React UI for display
  useEffect(() => {
    const timer = setInterval(() => {
      setEngineState({
        move: dmxEngine.currentMove,
        color: dmxEngine.currentColor,
        dimmer: dmxEngine.currentDimmerMode,
        phase: dmxEngine.currentPhaseMode,
        isRandom: dmxEngine.isRandomMode
      });
    }, 100);
    return () => clearInterval(timer);
  }, [dmxEngine]);

  const savePatch = () => {
    localStorage.setItem('lax_patch', JSON.stringify(fixtures));
    addLog("PATCH SAVED TO STORAGE");
  };

  const exportPatch = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(fixtures));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "lax_fixture_patch.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const importPatch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target?.result as string);
          setFixtures(json);
          addLog("PATCH IMPORTED FROM FILE");
        } catch(err) {
          addLog("IMPORT FAILED: INVALID JSON");
        }
      };
      reader.readAsText(file);
    }
  };

  const deleteFixture = (id: string) => {
    setFixtures(prev => prev.filter(f => f.id !== id));
  };

  // Protocols
  const CONSOLES = [
    "grandMA2 / grandMA3 Series",
    "Avolites / Tiger Touch Series",
    "Chamsys / MagicQ",
    "Road Hog / Hog 4",
    "国产明静 / 力度 / 韵鹏 专业控台"
  ];

  const [activeConsole, setActiveConsole] = useState(CONSOLES[0]);

  const toggleEngine = async () => {
    if (!isRunning) {
      if (fixtures.length === 0) {
        alert(lang === 'zh' ? "请先配接灯具以启动链路" : "PLEASE PATCH FIXTURES TO INITIATE LINK");
        return;
      }
      try {
        await audioEngine.start(selectedDeviceId);
        setIsRunning(true);
        addLog(`ENGINE ENGAGED | CONSOLE: ${activeConsole}`);
        startLoop();
      } catch (e) {
        addLog("ERROR: AUDIO ACCESS DENIED");
      }
    } else {
      setIsRunning(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      addLog("SYSTEM OFFLINE");
    }
  };

  const startLoop = () => {
    let lastTime = performance.now();
    
    const loop = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      audioEngine.process();
      setSpectrumData(audioEngine.getSpectrum());
      setBassHit(audioEngine.bassHit);
      setTrebleHit(audioEngine.trebleHit);
      setClimaxMode(audioEngine.climaxMode);

      const universes = dmxEngine.update(
        fixtures, 
        audioEngine.energy, 
        audioEngine.bassHit, 
        audioEngine.climaxMode, 
        delta,
        settings
      );

      // Throttled sending (~40fps)
      const nowMs = performance.now();
      
      if (nowMs - lastEmitTimeRef.current >= 25) {
        Object.entries(universes).forEach(([uni, buffer]) => {
          socketRef.current?.emit("dmx_frame", {
            universe: parseInt(uni),
            buffer: buffer,
            protocol: protocol,
            targetIp: (targetIp === "Multicast" || targetIp === "Broadcast") ? undefined : targetIp
          });
        });
        lastEmitTimeRef.current = nowMs;
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const addFixtureBatch = (name: string, count: number, startAddr: number, universe: number, position: FixturePosition) => {
    const fixDef = MASTER_FIXTURES[name];
    if (!fixDef) return;

    const newFix: ActiveFixture[] = [];
    const chCount = Math.max(...Object.values(fixDef.channels));
    
    for (let i = 0; i < count; i++) {
      const addr = startAddr + (i * chCount);
      if (addr > 512) break;
      newFix.push({
        id: Math.random().toString(36).substr(2, 9),
        name: `${name} #${fixtures.length + i + 1}`,
        type: fixDef.type,
        universe,
        addr,
        channels: { ...fixDef.channels },
        position
      });
    }
    setFixtures([...fixtures, ...newFix]);
    addLog(`PATCHED ${newFix.length} FIXTURES AT U${universe}/A${startAddr} (${position})`);
  };

  return (
    <div className="w-full h-screen bg-[#050505] text-[#e0e0e0] font-sans overflow-hidden flex flex-col relative select-none">
      <div className="absolute inset-0 bg-grid pointer-events-none"></div>
      
      {/* HUD Header */}
      <header className="h-16 border-b border-cyan/30 flex items-center justify-between px-8 bg-black/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${isRunning ? "bg-[#00f2ff] animate-pulse" : "bg-gray-700"}`}></div>
          <h1 className="text-xl font-bold tracking-[0.2em] uppercase glow-cyan">
            {t.engine_name} <span className="text-[#f27d26]">V16.0</span>
          </h1>
        </div>
        
        <div className="flex gap-8 text-[10px] font-mono uppercase text-gray-500">
          <div>{t.status}: <span className={isRunning ? "text-[#00f2ff]" : "text-gray-600"}>{isRunning ? t.active : t.ready}</span></div>
          <div>{t.protocol}: <span className="text-[#00f2ff]">{protocol}</span></div>
          <div>{t.core}: <span className="text-[#00f2ff]">Neural_V16_X64</span></div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')}
            className="px-3 py-1 border border-cyan/30 text-[10px] font-mono hover:bg-cyan/10 transition-colors"
          >
            {lang === 'en' ? 'ZH' : 'EN'}
          </button>
          <button 
            onClick={toggleEngine}
            className={`px-4 py-1.5 border font-mono text-[10px] uppercase tracking-widest transition-all ${
              isRunning 
                ? "bg-[#ff0044]/20 border-[#ff0044] text-[#ff0044] hover:bg-[#ff0044]/30" 
                : "bg-[#00f2ff]/20 border-[#00f2ff] text-[#00f2ff] hover:bg-[#00f2ff]/30"
            }`}
          >
            {isRunning ? t.terminate : t.engage}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex p-6 gap-6 z-10 min-h-0">
        {/* Left Sidebar - Navigation & Quick Stats */}
        <section className="w-1/4 flex flex-col gap-4">
          <div className="bg-black/60 border border-cyan/30 p-4 shrink-0 rounded-sm">
            <h3 className="text-[11px] uppercase tracking-widest text-[#00f2ff] mb-4 border-b border-cyan/20 pb-2">{t.navigation}</h3>
            <div className="flex flex-col gap-2">
              <NavButton label={t.neural_core} icon={<Activity size={14}/>} active={activeTab === 'main'} onClick={() => setActiveTab('main')} />
              <NavButton label={t.fixture_patch} icon={<Box size={14}/>} active={activeTab === 'patch'} onClick={() => setActiveTab('patch')} />
              <NavButton label={t.engine_cfg} icon={<Settings size={14}/>} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
            </div>
          </div>

          <div className="bg-black/60 border border-cyan/30 p-4 flex-1 rounded-sm overflow-hidden flex flex-col">
            <h3 className="text-[11px] uppercase tracking-widest text-[#00f2ff] mb-4 border-b border-cyan/20 pb-2">{t.audio_sensing}</h3>
            <div className="space-y-6 overflow-y-auto pr-1">
              <AudioBar label={t.bass} active={bassHit} color={ORANGE} val={bassHit ? 85 : 10} suffix="3.5x Trigger" />
              <AudioBar label={t.treble} active={trebleHit} color={CYAN} val={trebleHit ? 70 : 15} suffix="Dynamic" />
              
              <div className="pt-4 mt-4 border-t border-cyan/10">
                <AnimatePresence>
                  {climaxMode ? (
                    <motion.div 
                      key="climax"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="p-3 climax-pulse bg-[#ff0044]/10 rounded flex flex-col items-center gap-1"
                    >
                      <span className="text-[10px] font-bold text-[#ff0044] uppercase tracking-tighter">{t.climax_mode}</span>
                      <span className="text-[9px] text-[#ff0044]/80 font-mono italic">{t.active_at_energy}</span>
                    </motion.div>
                  ) : (
                    <div className="p-3 border border-dashed border-cyan/10 rounded flex flex-col items-center gap-1 opacity-20">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">{t.normal_op}</span>
                      <span className="text-[9px] text-gray-600 font-mono italic">{t.awaiting_climax}</span>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="bg-black/60 border border-cyan/30 p-4 rounded-sm">
            <h3 className="text-[11px] uppercase tracking-widest text-[#00f2ff] mb-4">{t.shutter_cfg}</h3>
            <button 
              onClick={() => setSettings(s => ({ ...s, ovrShutterLock: !s.ovrShutterLock }))}
              className={`w-full flex items-center justify-between border p-2 mb-2 transition-all ${settings.ovrShutterLock ? "border-orange-500/40 bg-[#f27d26]/5" : "border-cyan/20 bg-cyan/5"}`}
            >
              <span className="text-[10px] font-mono">{t.shutter_mode}</span>
              <span className={`text-[10px] font-bold uppercase ${settings.ovrShutterLock ? "text-[#f27d26] glow-orange" : "text-cyan-400"}`}>
                {settings.ovrShutterLock ? t.locked : t.unlocked}
              </span>
            </button>
            <div className="text-[9px] text-gray-500 leading-relaxed font-mono">
              {t.shutter_note}
            </div>
          </div>
        </section>

        {/* Dynamic Center View */}
        <section className="flex-1 flex flex-col gap-6 min-w-0">
          {activeTab === 'main' ? (
            <>
              <div className="bg-black/80 border border-cyan/70 p-6 flex-1 rounded-sm flex flex-col relative">
                <div className="absolute top-4 right-4 flex gap-2 z-20">
                  <div className="px-2 py-1 bg-[#00f2ff]/10 border border-[#00f2ff]/30 text-[9px] font-mono text-[#00f2ff]">30 BANDS FFT</div>
                  <div className="px-2 py-1 bg-[#f27d26]/10 border border-[#f27d26]/30 text-[9px] font-mono text-[#f27d26]">60 FPS</div>
                </div>
                
                <h3 className="text-xs uppercase tracking-[0.3em] font-light text-gray-400 mb-8 font-mono">{t.spectrum_anal}</h3>
                
                <div className="flex-1 min-h-0 relative">
                  <Spectrum 
                    data={spectrumData} 
                    bassHit={bassHit} 
                    trebleHit={trebleHit} 
                    climaxMode={climaxMode} 
                  />
                </div>

                <div className="h-8 flex border-t border-cyan/20 items-center justify-between px-2 mt-4">
                  {["60HZ", "250HZ", "1KHZ", "4KHZ", "12KHZ"].map(f => (
                    <span key={f} className="text-[9px] font-mono text-gray-600">{f}</span>
                  ))}
                </div>
              </div>

              <div className="h-32 flex gap-4 shrink-0">
                <div className="flex-1 bg-black/60 border border-cyan/40 p-4 flex flex-col justify-center rounded-sm">
                  <div className="text-[10px] text-[#00f2ff] uppercase mb-2 font-mono tracking-widest">{t.active_fixtures}</div>
                  <div className="flex gap-6 overflow-x-auto">
                    {fixtures.length > 0 ? (
                      <div className="flex gap-4">
                        {Array.from(new Set(fixtures.map(f => f.type))).map(type => (
                          <div key={type} className="text-xs font-mono whitespace-nowrap">
                            {type.toUpperCase()} <span className="text-[#f27d26]">x{fixtures.filter(f => f.type === type).length}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs font-mono text-gray-600">{t.null_patch}</div>
                    )}
                  </div>
                </div>
                <div className="flex-1 bg-black/60 border border-cyan/40 p-4 flex flex-col justify-center rounded-sm">
                  <div className="text-[10px] text-[#00f2ff] uppercase mb-1 font-mono tracking-widest">Signal Monitor</div>
                  <div className="space-y-1">
                    {logs.length === 0 ? (
                      <div className="text-[10px] text-cyan-900 font-mono italic">Waiting for signal...</div>
                    ) : (
                      logs.map((log, i) => (
                        <div key={i} className="text-[10px] font-mono text-cyan-400 flex items-center gap-2">
                          <span className="w-1 h-1 rounded-full bg-cyan-500 animate-pulse" />
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex-1 bg-black/60 border border-cyan/40 p-4 flex flex-col justify-center rounded-sm">
                  <div className="text-[10px] text-[#00f2ff] uppercase mb-1 font-mono tracking-widest">{t.interpolation}</div>
                  <div className="text-xs font-mono uppercase">
                    {t.lerp_damping}: <span className="text-[#f27d26]">{isRunning ? "0.82ms" : "IDLE"}</span>
                  </div>
                  <div className="text-[9px] text-gray-500 font-mono mt-1">{t.smooth_motor}</div>
                </div>
              </div>
            </>
          ) : activeTab === 'patch' ? (
            <div className="bg-black/80 border border-cyan/70 p-6 flex-1 rounded-sm overflow-auto">
              <h2 className="text-xs uppercase tracking-[0.3em] font-mono text-[#00f2ff] mb-8 border-b border-cyan/20 pb-4">{t.matrix_patching}</h2>
              
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="space-y-4">
                    <Field label={t.host_console}>
                      <select 
                        value={activeConsole}
                        onChange={(e) => setActiveConsole(e.target.value)}
                        className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-orange-400 focus:border-[#f27d26] outline-none"
                      >
                        {CONSOLES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>

                    <Field label={t.target_def}>
                      <select id="fix-select" className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-cyan-400 focus:border-[#00f2ff] outline-none">
                        {Object.keys(MASTER_FIXTURES).map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </Field>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t.density}>
                        <input id="fix-qty" type="number" defaultValue="4" className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-cyan-400" />
                      </Field>
                      <Field label={t.position}>
                        <select id="fix-pos" className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-cyan-400">
                          {Object.entries(t.pos).map(([k, v]: any) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                       <Field label={t.universe}>
                        <input id="fix-uni" type="number" defaultValue="1" className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-cyan-400" />
                      </Field>
                      <Field label={t.base_addr}>
                        <input id="fix-addr" type="number" defaultValue="1" className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-cyan-400" />
                      </Field>
                    </div>

                    <button 
                      onClick={() => {
                        const sel = (document.getElementById('fix-select') as HTMLSelectElement).value;
                        const qty = parseInt((document.getElementById('fix-qty') as HTMLInputElement).value);
                        const addr = parseInt((document.getElementById('fix-addr') as HTMLInputElement).value);
                        const uni = parseInt((document.getElementById('fix-uni') as HTMLInputElement).value);
                        const pos = (document.getElementById('fix-pos') as HTMLSelectElement).value as FixturePosition;
                        addFixtureBatch(sel, qty, addr, uni, pos);
                      }}
                      className="w-full py-4 bg-cyan-900/20 border border-cyan/50 text-[#00f2ff] font-mono text-xs uppercase tracking-[.2em] hover:bg-cyan-500 hover:text-black transition-all"
                    >
                      {t.process_patch}
                    </button>
                  </div>
                </div>

                <div className="bg-black/50 border border-cyan/20 p-4 rounded-sm flex flex-col min-h-0">
                  <div className="text-[10px] uppercase font-mono text-gray-500 mb-4 flex justify-between items-center">
                    <span>{t.nodes}</span>
                    <div className="flex gap-2">
                       <button onClick={savePatch} className="text-[8px] border border-cyan/20 px-1 py-0.5 hover:bg-cyan/10">{t.save_patch}</button>
                       <label className="text-[8px] border border-cyan/20 px-1 py-0.5 hover:bg-cyan/10 cursor-pointer">
                        {t.import_patch}
                        <input type="file" className="hidden" accept=".json" onChange={importPatch} />
                       </label>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto pr-2 space-y-2 font-mono scrollbar-hide">
                    {fixtures.length > 0 ? fixtures.map((f, i) => (
                      <div key={f.id} className="text-[10px] flex flex-col border-b border-cyan/5 pb-2 group">
                        <div className="flex justify-between items-start">
                          <span className="text-gray-400">[{i}] {f.name}</span>
                          <div className="flex flex-col items-end">
                            <span className="text-[#f27d26]">U{f.universe}.A{f.addr}</span>
                            <button 
                              onClick={() => deleteFixture(f.id)}
                              className="text-[8px] text-red-500 opacity-0 group-hover:opacity-100 transition-opacity uppercase"
                            >
                              {t.delete_fixture}
                            </button>
                          </div>
                        </div>
                        <div className="text-[8px] text-gray-600 text-left uppercase">Position: {t.pos[f.position]}</div>
                      </div>
                    )) : (
                      <div className="text-[10px] text-gray-700 italic">{t.empty_buffer}</div>
                    )}
                  </div>
                  {fixtures.length > 0 && (
                    <div className="flex justify-between mt-4">
                      <button onClick={exportPatch} className="text-[9px] text-[#00f2ff]/50 hover:text-[#00f2ff] uppercase font-mono">EXPORT_JSON</button>
                      <button onClick={() => setFixtures([])} className="text-[9px] text-red-500/50 hover:text-red-500 uppercase font-mono transition-colors">
                        {t.purge}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-black/80 border border-cyan/70 p-6 flex-1 rounded-sm">
              <h2 className="text-xs uppercase tracking-[0.3em] font-mono text-[#00f2ff] mb-8 border-b border-cyan/20 pb-4">{t.system_cfg}</h2>
              
              <div className="max-w-md space-y-8">
                <div>
                  <label className="text-[10px] font-mono uppercase text-gray-500 mb-2 block">{t.audio_input}</label>
                  <select 
                    value={selectedDeviceId}
                    onChange={(e) => {
                      setSelectedDeviceId(e.target.value);
                      if (isRunning) toggleEngine().then(() => toggleEngine()); // cycle to reconnect
                    }}
                    className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-[#39FF14] outline-none"
                  >
                    {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0, 5)}`}</option>)}
                  </select>
                </div>

                <InterventionSlider label={t.master_dim} val={settings.ovrDimmer} max={255} onChange={v => setSettings(s => ({...s, ovrDimmer: v}))} />
                <InterventionSlider label={t.motor_damping} val={settings.ovrPtSpeed} max={255} onChange={v => setSettings(s => ({...s, ovrPtSpeed: v}))} />
                <InterventionSlider label={t.frost} val={settings.ovrFrost} max={255} onChange={v => setSettings(s => ({...s, ovrFrost: v}))} />
                
                <div className="pt-6 border-t border-cyan/10">
                   <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-mono uppercase text-gray-500">{t.target_vector}</span>
                      <select 
                        value={protocol} 
                        onChange={(e) => setProtocol(e.target.value)}
                        className="bg-black/50 border border-cyan/30 text-[10px] font-mono text-[#00f2ff] outline-none"
                      >
                        <option value="Art-Net">Art-Net</option>
                        <option value="sACN">sACN (E1.31)</option>
                      </select>
                   </div>
                   <Field label={t.target_ip}>
                     <div className="flex gap-2">
                       <input 
                        value={targetIp} 
                        onChange={e => setTargetIp(e.target.value)}
                        className="flex-1 bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-[#f27d26] outline-none focus:border-[#f27d26]/60"
                        placeholder="IP or Broadcast"
                       />
                       <button 
                        onClick={() => setTargetIp(protocol === "sACN" ? "Multicast" : "Broadcast")}
                        className="px-2 border border-cyan/30 text-[9px] hover:bg-cyan/10"
                       >
                        AUTO
                       </button>
                     </div>
                   </Field>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right Sidebar - Logic & Patterns */}
        <section className="w-1/4 flex flex-col gap-4">
          <div className="bg-black/60 border border-cyan/30 p-4 flex-1 rounded-sm flex flex-col min-h-0">
            <div className="flex justify-between items-center border-b border-cyan/20 pb-2 mb-4">
              <h3 className="text-[11px] uppercase tracking-widest text-[#00f2ff]">{t.movement_array}</h3>
              <button 
                onClick={() => {
                  dmxEngine.isRandomMode = !dmxEngine.isRandomMode;
                  setEngineState(s => ({ ...s, isRandom: dmxEngine.isRandomMode }));
                }}
                className={`text-[8px] font-mono px-1.5 py-0.5 border ${engineState.isRandom ? "bg-cyan/20 border-cyan text-cyan" : "border-gray-700 text-gray-500"}`}
              >
                {t.random_mode}: {engineState.isRandom ? "ON" : "OFF"}
              </button>
            </div>
            <div className="space-y-1 text-[10px] font-mono flex-1 overflow-auto overflow-x-hidden pr-1 scrollbar-hide">
              {["sweep", "wave", "circle", "symmetry", "fan", "cross"].map(m => (
                <button 
                  key={m} 
                  onClick={() => {
                    dmxEngine.currentMove = m as any;
                    dmxEngine.isRandomMode = false;
                  }}
                  className={`w-full text-left p-2 transition-all ${dmxEngine.currentMove === m ? "bg-[#00f2ff]/20 text-[#00f2ff] border-l-2 border-[#00f2ff]" : "opacity-30 hover:bg-white/5"}`}
                >
                  {m.toUpperCase()}
                </button>
              ))}

              <h3 className="text-[10px] uppercase tracking-widest text-gray-500 mt-6 mb-2 border-b border-white/5 pb-1">{t.dimmer_array}</h3>
              {["sync", "pulse", "stack"].map(d => (
                <button 
                  key={d} 
                  onClick={() => {
                    dmxEngine.currentDimmerMode = d as any;
                    dmxEngine.isRandomMode = false;
                  }}
                  className={`w-full text-left p-1.5 transition-all ${dmxEngine.currentDimmerMode === d ? "text-[#f27d26]" : "opacity-30"}`}
                >
                  {d.toUpperCase()}
                </button>
              ))}

              <h3 className="text-[10px] uppercase tracking-widest text-gray-500 mt-6 mb-2 border-b border-white/5 pb-1">{t.color_array}</h3>
              {["sync", "rainbow", "chase"].map(c => (
                <button 
                  key={c} 
                  onClick={() => {
                    dmxEngine.currentColor = c as any;
                    dmxEngine.isRandomMode = false;
                  }}
                  className={`w-full text-left p-1.5 transition-all ${dmxEngine.currentColor === c ? "text-[#39FF14]" : "opacity-30"}`}
                >
                  {c.toUpperCase()}
                </button>
              ))}
            </div>

            <h3 className="text-[11px] uppercase tracking-widest text-[#00f2ff] mt-6 mb-4 border-b border-cyan/20 pb-2">{t.phase_offsets}</h3>
            <div className="grid grid-cols-1 gap-1 text-[9px] font-mono">
              {["uniform", "odd_even_offset", "gradient"].map(p => (
                <button 
                  key={p} 
                  onClick={() => {
                    dmxEngine.currentPhaseMode = p as any;
                  }}
                  className={`p-2 border transition-all text-left ${dmxEngine.currentPhaseMode === p ? "border-[#00f2ff] bg-cyan/10 text-cyan-400" : "border-cyan/20 text-gray-500 opacity-60"}`}
                >
                  {p.replace('_offset', '').toUpperCase()}
                </button>
              ))}
            </div>

            <div className="mt-6 p-3 border border-dashed border-cyan/30 rounded-sm bg-black/40">
              <div className="text-[9px] text-gray-500 mb-2 font-mono uppercase tracking-widest font-bold">{t.engine_stream}</div>
              <div className="text-[9px] font-mono text-green-500/80 leading-tight h-20 overflow-hidden">
                {logs.map((log, i) => (
                  <div key={i} className="whitespace-nowrap overflow-hidden text-ellipsis mb-0.5">{log}</div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Cyber Footer */}
      <footer className="h-10 bg-black/80 border-t border-cyan/30 flex items-center px-8 justify-between text-[9px] font-mono uppercase text-gray-500 z-10 shrink-0">
        <div className="flex gap-6">
          <span>{protocol} {lang === 'zh' ? '广播已开启' : 'Broadcast Active'}</span>
          <span>SR: 44.1k_X64</span>
          <span>DMX_TICK: 40HZ</span>
        </div>
        <div className="flex gap-4">
          <span>LATENCY_OPTIMIZED</span>
          <span>© 2026 LAX NEURAL CORE SYSTEMS</span>
        </div>
      </footer>
    </div>
  );
}

function NavButton({ label, icon, active, onClick }: { label: string, icon: any, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-3 p-3 transition-all font-mono text-[10px] tracking-widest uppercase rounded-sm border ${
        active ? "bg-cyan-500/10 border-cyan/60 text-[#00f2ff] glow-cyan shadow-[0_0_10px_rgba(0,242,255,0.1)]" : "bg-transparent border-transparent text-gray-600 hover:text-gray-300 hover:bg-white/5"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function AudioBar({ label, val, active, color, suffix }: { label: string, val: number, active: boolean, color: string, suffix: string }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end">
        <span className="text-[10px] font-mono uppercase text-gray-400">{label}</span>
        <span className={`text-[10px] font-mono font-bold`} style={{ color }}>{suffix}</span>
      </div>
      <div className="h-1 bg-gray-900 rounded-full overflow-hidden">
        <motion.div 
          initial={false}
          animate={{ width: `${val}%`, backgroundColor: color }}
          className="h-full"
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <div className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${active ? "animate-pulse" : "opacity-30"}`} style={{ backgroundColor: color }}></div>
        <span className="text-[9px] uppercase text-gray-600 font-mono">Real-time status: {active ? "Engaged" : "Scanning"}</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string, children: any }) {
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-mono uppercase text-gray-500">{label}</label>
      {children}
    </div>
  );
}

function InterventionSlider({ label, val, max, onChange }: { label: string, val: number, max: number, onChange: (v: number) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center text-[10px] font-mono uppercase text-gray-400">
        <span>{label}</span>
        <span className="text-[#00f2ff]">{val}</span>
      </div>
      <div className="relative h-1 w-full bg-gray-900 rounded-full group">
        <input 
          type="range" 
          min="0" 
          max={max} 
          value={val} 
          onChange={e => onChange(parseInt(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div 
          className="absolute h-full bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(0,242,255,0.5)] transition-all"
          style={{ width: `${(val/max)*100}%` }}
        />
        <div 
          className="absolute h-3 w-3 bg-white border-2 border-cyan-500 rounded-full -top-1 shadow-[0_0_10px_rgba(0,242,255,1)] transition-all pointer-events-none"
          style={{ left: `calc(${(val/max)*100}% - 6px)` }}
        />
      </div>
    </div>
  );
}

function NavItem({ icon, active, onClick, label }: { icon: any, active: boolean, onClick: () => void, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`group relative flex flex-col items-center gap-1 transition-all ${active ? "text-[#00FFFF]" : "text-gray-600 hover:text-white"}`}
    >
      <div className={`p-3 rounded-xl transition-all ${active ? "bg-[#00FFFF]/10 shadow-[0_0_15px_rgba(0,255,255,0.2)]" : "bg-transparent"}`}>
        {icon}
      </div>
      <span className="text-[10px] font-black tracking-tighter invisible group-hover:visible">{label}</span>
      {active && <motion.div layoutId="nav-active" className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#00FFFF] rounded-full" />}
    </button>
  );
}

function MetricCard({ label, active, color, val }: { label: string, active?: boolean, color?: string, val?: string | number }) {
  return (
    <div className={`bg-black/40 border border-[#222] p-2 flex flex-col transition-all overflow-hidden ${active ? "border-solid" : "border-dashed"}`} style={{ borderColor: active ? color : "#222" }}>
       <span className="text-[10px] text-gray-500 uppercase tracking-widest">{label}</span>
       <span className="text-xl font-black tracking-tighter" style={{ color: active ? color : "white" }}>
         {val ?? (active ? "ACTIVE" : "IDLE")}
       </span>
       {active && <motion.div initial={{ width: 0 }} animate={{ width: "100%" }} className="h-[2px] mt-1" style={{ backgroundColor: color }} />}
    </div>
  );
}

function RangeSetting({ label, val, onChange, max }: { label: string, val: number, onChange: (v: number) => void, max: number }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-xs font-mono">
        <span className="text-gray-400">{label.toUpperCase()}</span>
        <span className="text-[#00FFFF]">{val}</span>
      </div>
      <input 
        type="range" 
        min="0" 
        max={max} 
        value={val} 
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full accent-[#00FFFF] bg-[#333] h-1 rounded-full appearance-none cursor-pointer"
      />
    </div>
  )
}
