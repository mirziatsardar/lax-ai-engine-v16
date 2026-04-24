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
import { ActiveFixture } from './types';
import Spectrum from './components/Spectrum';

const BG_DARK = "#050505";
const PANEL_BG = "rgba(0, 0, 0, 0.6)";
const CYAN = "#00f2ff";
const ORANGE = "#f27d26";
const CLIMAX = "#ff0044";

export default function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [fixtures, setFixtures] = useState<ActiveFixture[]>([]);
  const [logs, setLogs] = useState<string[]>(["[OK] NEURAL CORE V16.0 STABLE"]);
  const [protocol, setProtocol] = useState("Art-Net");
  const [targetIp, setTargetIp] = useState("255.255.255.255");
  const [spectrumData, setSpectrumData] = useState(new Uint8Array(30));
  
  // Audio/DMX Engine Refs
  const audioEngine = useMemo(() => new AudioEngine(), []);
  const dmxEngine = useMemo(() => new DMXEngine(), []);
  const socketRef = useRef<Socket | null>(null);
  const rafRef = useRef<number | null>(null);
  
  // States from engine
  const [bassHit, setBassHit] = useState(false);
  const [trebleHit, setTrebleHit] = useState(false);
  const [climaxMode, setClimaxMode] = useState(false);

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
    return () => { socketRef.current?.disconnect(); };
  }, []);

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
        alert("PLEASE PATCH FIXTURES TO INITIATE LINK");
        return;
      }
      try {
        await audioEngine.start();
        setIsRunning(true);
        addLog(`ENGINE ENGAGED | CONSOLE: ${activeConsole}`);
        startLoop();
      } catch (e) {
        addLog("ERROR: MICROPHONE ACCESS DENIED");
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

      // Send to server
      Object.entries(universes).forEach(([uni, buffer]) => {
        socketRef.current?.emit("dmx_frame", {
          universe: parseInt(uni),
          buffer: buffer,
          protocol: protocol,
          targetIp: targetIp === "Multicast" ? undefined : targetIp
        });
      });

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const addFixtureBatch = (name: string, count: number, startAddr: number, universe: number) => {
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
        channels: { ...fixDef.channels }
      });
    }
    setFixtures([...fixtures, ...newFix]);
    addLog(`PATCHED ${newFix.length} FIXTURES AT U${universe}/A${startAddr}`);
  };

  return (
    <div className="w-full h-screen bg-[#050505] text-[#e0e0e0] font-sans overflow-hidden flex flex-col relative select-none">
      <div className="absolute inset-0 bg-grid pointer-events-none"></div>
      
      {/* HUD Header */}
      <header className="h-16 border-b border-cyan/30 flex items-center justify-between px-8 bg-black/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${isRunning ? "bg-[#00f2ff] animate-pulse" : "bg-gray-700"}`}></div>
          <h1 className="text-xl font-bold tracking-[0.2em] uppercase glow-cyan">
            LAX AI Engine <span className="text-[#f27d26]">V16.0</span>
          </h1>
        </div>
        
        <div className="flex gap-8 text-[10px] font-mono uppercase text-gray-500">
          <div>Status: <span className={isRunning ? "text-[#00f2ff]" : "text-gray-600"}>{isRunning ? "Active" : "Ready"}</span></div>
          <div>Protocol: <span className="text-[#00f2ff]">{protocol}</span></div>
          <div>Core: <span className="text-[#00f2ff]">Neural_V16_X64</span></div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={toggleEngine}
            className={`px-4 py-1.5 border font-mono text-[10px] uppercase tracking-widest transition-all ${
              isRunning 
                ? "bg-[#ff0044]/20 border-[#ff0044] text-[#ff0044] hover:bg-[#ff0044]/30" 
                : "bg-[#00f2ff]/20 border-[#00f2ff] text-[#00f2ff] hover:bg-[#00f2ff]/30"
            }`}
          >
            {isRunning ? "TERMINATE LINK" : "ENGAGE LINK"}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex p-6 gap-6 z-10 min-h-0">
        {/* Left Sidebar - Navigation & Quick Stats */}
        <section className="w-1/4 flex flex-col gap-4">
          <div className="bg-black/60 border border-cyan/30 p-4 shrink-0 rounded-sm">
            <h3 className="text-[11px] uppercase tracking-widest text-[#00f2ff] mb-4 border-b border-cyan/20 pb-2">Navigation</h3>
            <div className="flex flex-col gap-2">
              <NavButton label="Neural Core" icon={<Activity size={14}/>} active={activeTab === 'main'} onClick={() => setActiveTab('main')} />
              <NavButton label="Fixture Patch" icon={<Box size={14}/>} active={activeTab === 'patch'} onClick={() => setActiveTab('patch')} />
              <NavButton label="Engine Cfg" icon={<Settings size={14}/>} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
            </div>
          </div>

          <div className="bg-black/60 border border-cyan/30 p-4 flex-1 rounded-sm overflow-hidden flex flex-col">
            <h3 className="text-[11px] uppercase tracking-widest text-[#00f2ff] mb-4 border-b border-cyan/20 pb-2">Audio Sensing Logic</h3>
            <div className="space-y-6 overflow-y-auto pr-1">
              <AudioBar label="Bass (60Hz-150Hz)" active={bassHit} color={ORANGE} val={bassHit ? 85 : 10} suffix="3.5x Trigger" />
              <AudioBar label="Treble (2kHz-8kHz)" active={trebleHit} color={CYAN} val={trebleHit ? 70 : 15} suffix="Dynamic" />
              
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
                      <span className="text-[10px] font-bold text-[#ff0044] uppercase tracking-tighter">Climax Mode (狂暴模式)</span>
                      <span className="text-[9px] text-[#ff0044]/80 font-mono italic">ACTIVE AT HIGH ENERGY</span>
                    </motion.div>
                  ) : (
                    <div className="p-3 border border-dashed border-cyan/10 rounded flex flex-col items-center gap-1 opacity-20">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">Normal Operation</span>
                      <span className="text-[9px] text-gray-600 font-mono italic">AWAITING CLIMAX THRESHOLD</span>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="bg-black/60 border border-cyan/30 p-4 rounded-sm">
            <h3 className="text-[11px] uppercase tracking-widest text-[#00f2ff] mb-4">Shutter Configuration</h3>
            <div className={`flex items-center justify-between border p-2 mb-2 ${settings.ovrShutterLock ? "border-orange-500/40 bg-[#f27d26]/5" : "border-cyan/20 bg-cyan/5"}`}>
              <span className="text-[10px] font-mono">SHUTTER MODE</span>
              <span className={`text-[10px] font-bold uppercase ${settings.ovrShutterLock ? "text-[#f27d26] glow-orange" : "text-cyan-400"}`}>
                {settings.ovrShutterLock ? "Locked" : "Unlocked"}
              </span>
            </div>
            <div className="text-[9px] text-gray-500 leading-relaxed font-mono">
              Lock: Bass only triggers color change.<br />
              Unlock: 0.15s Fast Strobe sync enabled.
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
                
                <h3 className="text-xs uppercase tracking-[0.3em] font-light text-gray-400 mb-8 font-mono">Neural Real-time Spectrum分析</h3>
                
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
                  <div className="text-[10px] text-[#00f2ff] uppercase mb-2 font-mono tracking-widest">Active Fixtures</div>
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
                      <div className="text-xs font-mono text-gray-600">NULL_PATCH_VECTOR</div>
                    )}
                  </div>
                </div>
                <div className="flex-1 bg-black/60 border border-cyan/40 p-4 flex flex-col justify-center rounded-sm">
                  <div className="text-[10px] text-[#00f2ff] uppercase mb-1 font-mono tracking-widest">Interpolation Engine</div>
                  <div className="text-xs font-mono uppercase">
                    LERP Damping: <span className="text-[#f27d26]">{isRunning ? "0.82ms" : "IDLE"}</span>
                  </div>
                  <div className="text-[9px] text-gray-500 font-mono mt-1">SMOOTH MOTOR SIMULATION ACTIVE</div>
                </div>
              </div>
            </>
          ) : activeTab === 'patch' ? (
            <div className="bg-black/80 border border-cyan/70 p-6 flex-1 rounded-sm overflow-auto">
              <h2 className="text-xs uppercase tracking-[0.3em] font-mono text-[#00f2ff] mb-8 border-b border-cyan/20 pb-4">Matrix Data Patching</h2>
              
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="space-y-4">
                    <Field label="Host Console Environment">
                      <select 
                        value={activeConsole}
                        onChange={(e) => setActiveConsole(e.target.value)}
                        className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-orange-400 focus:border-[#f27d26] outline-none"
                      >
                        {CONSOLES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>

                    <Field label="Target Definition">
                      <select id="fix-select" className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-cyan-400 focus:border-[#00f2ff] outline-none">
                        {Object.keys(MASTER_FIXTURES).map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </Field>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Density">
                        <input id="fix-qty" type="number" defaultValue="4" className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-cyan-400" />
                      </Field>
                      <Field label="Universe">
                        <input id="fix-uni" type="number" defaultValue="1" className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-cyan-400" />
                      </Field>
                      <Field label="Base Addr">
                        <input id="fix-addr" type="number" defaultValue="1" className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-cyan-400" />
                      </Field>
                    </div>

                    <button 
                      onClick={() => {
                        const sel = (document.getElementById('fix-select') as HTMLSelectElement).value;
                        const qty = parseInt((document.getElementById('fix-qty') as HTMLInputElement).value);
                        const addr = parseInt((document.getElementById('fix-addr') as HTMLInputElement).value);
                        const uni = parseInt((document.getElementById('fix-uni') as HTMLInputElement).value);
                        addFixtureBatch(sel, qty, addr, uni);
                      }}
                      className="w-full py-4 bg-cyan-900/20 border border-cyan/50 text-[#00f2ff] font-mono text-xs uppercase tracking-[.2em] hover:bg-cyan-500 hover:text-black transition-all"
                    >
                      Process Vector Extraction
                    </button>
                  </div>
                </div>

                <div className="bg-black/50 border border-cyan/20 p-4 rounded-sm flex flex-col min-h-0">
                  <div className="text-[10px] uppercase font-mono text-gray-500 mb-4 flex justify-between">
                    <span>Active Matrix Nodes</span>
                    <span className="text-[#00f2ff]">TOTAL: {fixtures.length}</span>
                  </div>
                  <div className="flex-1 overflow-auto pr-2 space-y-2 font-mono scrollbar-hide">
                    {fixtures.length > 0 ? fixtures.map((f, i) => (
                      <div key={f.id} className="text-[10px] flex justify-between border-b border-cyan/5 pb-1">
                        <span className="text-gray-400">[{i}] {f.name}</span>
                        <span className="text-[#f27d26]">U{f.universe}.A{f.addr}</span>
                      </div>
                    )) : (
                      <div className="text-[10px] text-gray-700 italic">EMPTY_DATA_BUFFER</div>
                    )}
                  </div>
                  {fixtures.length > 0 && (
                    <button onClick={() => setFixtures([])} className="mt-4 text-[9px] text-red-500/50 hover:text-red-500 uppercase font-mono transition-colors">
                      [ PURGE_CORE_MEMORY ]
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-black/80 border border-cyan/70 p-6 flex-1 rounded-sm">
              <h2 className="text-xs uppercase tracking-[0.3em] font-mono text-[#00f2ff] mb-8 border-b border-cyan/20 pb-4">System Intervention Config</h2>
              
              <div className="max-w-md space-y-8">
                <InterventionSlider label="Luminance Master" val={settings.ovrDimmer} max={255} onChange={v => setSettings(s => ({...s, ovrDimmer: v}))} />
                <InterventionSlider label="Motor Damping" val={settings.ovrPtSpeed} max={255} onChange={v => setSettings(s => ({...s, ovrPtSpeed: v}))} />
                <InterventionSlider label="Atmospheric Frost" val={settings.ovrFrost} max={255} onChange={v => setSettings(s => ({...s, ovrFrost: v}))} />
                
                <div className="pt-6 border-t border-cyan/10">
                   <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-mono uppercase text-gray-500">Output Protocol Vector</span>
                      <select 
                        value={protocol} 
                        onChange={(e) => setProtocol(e.target.value)}
                        className="bg-black/50 border border-cyan/30 text-[10px] font-mono text-[#00f2ff] outline-none"
                      >
                        <option value="Art-Net">Art-Net</option>
                        <option value="sACN">sACN (E1.31)</option>
                      </select>
                   </div>
                   <Field label="Target IP (Unicast/Multicast)">
                     <input 
                      value={targetIp} 
                      onChange={e => setTargetIp(e.target.value)}
                      className="w-full bg-black/50 border border-cyan/30 p-2 text-xs font-mono text-[#f27d26] outline-none focus:border-[#f27d26]/60"
                     />
                   </Field>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right Sidebar - Logic & Patterns */}
        <section className="w-1/4 flex flex-col gap-4">
          <div className="bg-black/60 border border-cyan/30 p-4 flex-1 rounded-sm flex flex-col min-h-0">
            <h3 className="text-[11px] uppercase tracking-widest text-[#00f2ff] mb-4 border-b border-cyan/20 pb-2">Movement Array</h3>
            <div className="space-y-1 mt-2 text-[11px] font-mono flex-1 overflow-auto overflow-x-hidden pr-1">
              {["sweep", "wave", "circle", "symmetry", "fan", "cross"].map(m => (
                <div 
                  key={m} 
                  className={`p-2 transition-all cursor-default ${dmxEngine.currentMove === m ? "bg-[#00f2ff]/20 text-[#00f2ff] border-l-2 border-[#00f2ff] glow-cyan" : "opacity-40 hover:bg-white/5"}`}
                >
                  {m.toUpperCase()}_MODE
                </div>
              ))}
            </div>

            <h3 className="text-[11px] uppercase tracking-widest text-[#00f2ff] mt-6 mb-4 border-b border-cyan/20 pb-2">Phase Offsets</h3>
            <div className="grid grid-cols-2 gap-2 text-[9px] font-mono">
              {["uniform", "odd_even_offset", "gradient"].map(p => (
                <div key={p} className={`p-2 border transition-all text-center ${dmxEngine.currentPhaseMode === p ? "border-[#00f2ff] bg-cyan/10 text-cyan-400 glow-cyan" : "border-cyan/20 text-gray-500 opacity-60"}`}>
                  {p.replace('_offset', '').toUpperCase()}
                </div>
              ))}
            </div>

            <div className="mt-6 p-3 border border-dashed border-cyan/30 rounded-sm bg-black/40">
              <div className="text-[9px] text-gray-500 mb-2 font-mono uppercase tracking-widest font-bold">Engine_Log_Stream</div>
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
          <span>{protocol} Broadcast Active</span>
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
