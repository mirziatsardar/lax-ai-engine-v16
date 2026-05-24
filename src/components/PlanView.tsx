import React, { useState, useRef, useEffect, MouseEvent } from 'react';
import { ActiveFixture } from '../types';
import { DMXEngine } from '../lib/dmxEngine';
import { motion, useDragControls } from 'motion/react';
import { X, Move, Plus, Minus } from 'lucide-react';

interface PlanViewProps {
  fixtures: ActiveFixture[];
  engine: DMXEngine;
  onClose: () => void;
}

export function PlanView({ fixtures, engine, onClose }: PlanViewProps) {
  const dragControls = useDragControls();
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [frost, setFrost] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  
  // Track fixture positions visually (just 2D normalized coordinates 0-1)
  const [fixturePositions, setFixturePositions] = useState<Record<string, {x: number, y: number}>>({});

  useEffect(() => {
    engine.planModeActive = true;
    return () => {
      engine.planModeActive = false;
    };
  }, [engine]);

  const movableFixtures = fixtures.filter(f => f.channels && (f.channels['Pan'] !== undefined || f.channels['PanFine'] !== undefined));

  useEffect(() => {
    // Load from local or generate initial positions
    const savedPos = localStorage.getItem('lax_fixture_pos');
    const poss: Record<string, {x: number, y: number}> = savedPos ? JSON.parse(savedPos) : {};
    
    let needsSave = false;
    movableFixtures.forEach((f, i) => {
      if (!poss[f.id]) {
        poss[f.id] = {
          x: 0.1 + (i % 10) * 0.08,
          y: 0.2 + Math.floor(i / 10) * 0.15
        };
        needsSave = true;
      }
    });
    setFixturePositions(poss);
    if (needsSave) {
      localStorage.setItem('lax_fixture_pos', JSON.stringify(poss));
    }
  }, [fixtures]);

  const savePositions = (newPoss: Record<string, {x: number, y: number}>) => {
    setFixturePositions(newPoss);
    localStorage.setItem('lax_fixture_pos', JSON.stringify(newPoss));
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || selectedFixtureIds.length === 0) return;
    
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const pan16 = Math.floor(x * 65535);
    const tilt16 = Math.floor(y * 65535);

    selectedFixtureIds.forEach(id => {
       if (!engine.planOverrides[id]) {
         engine.planOverrides[id] = { active: true, pan: pan16, tilt: tilt16, frost };
       } else {
         engine.planOverrides[id].pan = pan16;
         engine.planOverrides[id].tilt = tilt16;
         engine.planOverrides[id].frost = frost;
       }
    });
    
    // Force re-render to draw lines
    setFrost(f => f); 
  };

  useEffect(() => {
    selectedFixtureIds.forEach(id => {
       if (engine.planOverrides[id]) {
         engine.planOverrides[id].frost = frost;
       }
    });
  }, [frost, selectedFixtureIds, engine]);

  // Handle Dragging of fixture icons
  const draggedIdRef = useRef<string | null>(null);

  const startDrag = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    draggedIdRef.current = id;
    if (!selectedFixtureIds.includes(id)) {
      if (e.shiftKey) {
        setSelectedFixtureIds([...selectedFixtureIds, id]);
      } else {
        setSelectedFixtureIds([id]);
      }
    }
  };

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!draggedIdRef.current) return;
    const rect = canvasRef.current?.parentElement?.getBoundingClientRect();
    if (!rect) return;
    
    // Calculate new normalized position
    let newX = (e.clientX - rect.left) / rect.width;
    let newY = (e.clientY - rect.top) / rect.height;
    
    newX = Math.max(0.02, Math.min(0.98, newX));
    newY = Math.max(0.02, Math.min(0.98, newY));

    const newPoss = { ...fixturePositions, [draggedIdRef.current]: { x: newX, y: newY } };
    savePositions(newPoss);
  };

  const onMouseUp = () => {
    draggedIdRef.current = null;
  };

  // Draw canvas
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;
    
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(0, 242, 255, 0.05)';
    ctx.lineWidth = 1;
    for(let i=0; i<10; i++) {
       ctx.beginPath();
       ctx.moveTo(i * width/10, 0);
       ctx.lineTo(i * width/10, height);
       ctx.stroke();
       ctx.beginPath();
       ctx.moveTo(0, i * height/10);
       ctx.lineTo(width, i * height/10);
       ctx.stroke();
    }

    const movableFixtures = fixtures.filter(f => f.channels && (f.channels['Pan'] !== undefined || f.channels['PanFine'] !== undefined));
    movableFixtures.forEach(f => {
      if (engine.planOverrides[f.id] && engine.planOverrides[f.id].active) {
        const ovr = engine.planOverrides[f.id];
        const fixPos = fixturePositions[f.id];
        if (fixPos) {
           const fpX = fixPos.x * width;
           const fpY = fixPos.y * height;
           const tarX = (ovr.pan / 65535) * width;
           const tarY = (ovr.tilt / 65535) * height;

           ctx.beginPath();
           ctx.moveTo(fpX, fpY);
           ctx.lineTo(tarX, tarY);
           ctx.strokeStyle = ovr.frost ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 242, 255, 0.8)';
           ctx.lineWidth = ovr.frost ? 15 : 2;
           ctx.stroke();
           
           ctx.beginPath();
           ctx.arc(tarX, tarY, 4, 0, Math.PI*2);
           ctx.fillStyle = '#fff';
           ctx.fill();
        }
      }
    });
  });

  return (
    <motion.div 
      drag 
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      style={{
        position: 'absolute',
        top: '10%',
        left: '10%',
        width: '80%',
        maxWidth: '1000px',
        zIndex: 50,
      }}
      className="bg-[#0a0a0a] border border-[#00f2ff]/50 shadow-2xl shadow-cyan-900/20 rounded-sm flex flex-col font-mono"
    >
      <div 
        onPointerDown={(e) => dragControls.start(e)}
        className="h-10 border-b border-[#00f2ff]/20 bg-[#00f2ff]/5 flex items-center justify-between px-4 cursor-move"
      >
        <div className="flex items-center gap-3">
          <Move size={14} className="text-[#00f2ff]" />
          <h2 className="text-xs uppercase tracking-[0.3em] font-mono text-[#00f2ff] font-bold">Plan View (平面图定位)</h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-2 py-0.5 border border-[#00f2ff]/50 bg-cyan-500/20 text-[#00f2ff] text-[9px] uppercase tracking-widest">
            Plan Override: ACTIVE
          </div>
          <button onClick={onClose} className="text-cyan-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="p-4 flex gap-6 h-[500px]">
        {/* Left Side: Canvas */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex justify-between items-center bg-black border border-cyan/20 px-2 py-1 rounded">
             <span className="text-[10px] text-cyan-500/50">Click canvas to aim beam. Drag icons to set mounting position.</span>
             <div className="flex gap-2">
               <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.5))} className="px-2 border border-cyan/30 text-cyan-500 hover:bg-cyan/10">
                 <Minus size={12} />
               </button>
               <span className="text-[10px] text-cyan-500 min-w-8 text-center">{Math.round(zoom * 100)}%</span>
               <button onClick={() => setZoom(z => Math.min(z + 0.2, 2.5))} className="px-2 border border-cyan/30 text-cyan-500 hover:bg-cyan/10">
                 <Plus size={12} />
               </button>
             </div>
          </div>
          <div 
            className="flex-1 border border-cyan/20 bg-black relative rounded overflow-auto"
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', minWidth: '100%', minHeight: '100%' }} className="relative">
              <canvas 
                ref={canvasRef}
                width={800}
                height={500}
                className="w-full h-full cursor-crosshair absolute top-0 left-0"
                onClick={handleCanvasClick}
              />
              
              {/* Render fixture positions visually */}
              {movableFixtures.map((f, i) => {
                  const pos = fixturePositions[f.id];
                  if (!pos) return null;
                  const isSelected = selectedFixtureIds.includes(f.id);
                  const isOverrideActive = engine.planOverrides[f.id]?.active;
                  return (
                    <div 
                      key={f.id}
                      onMouseDown={(e) => startDrag(e, f.id)}
                      className={`absolute w-6 h-6 -ml-3 -mt-3 rounded-full flex items-center justify-center text-[10px] cursor-grab active:cursor-grabbing transition-colors border ${isSelected ? 'border-[#00f2ff] bg-cyan-500/30 z-10 shadow-[0_0_10px_#00f2ff]' : isOverrideActive ? 'border-[#00f2ff]/50 bg-black text-[#00f2ff]' : 'border-gray-600 bg-black text-gray-600 hover:border-cyan-500'}`}
                      style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
                      title={f.name}
                    >
                      {i + 1}
                    </div>
                  );
              })}
            </div>
          </div>
        </div>

        {/* Right Side: Options for selected fixture */}
        <div className="w-56 flex flex-col gap-4 overflow-auto">
           {selectedFixtureIds.length === 0 ? (
             <div className="flex flex-col gap-4 text-[10px] text-gray-500 border border-gray-800 p-4 text-center">
               <span>Select a beam fixture from the plan to override and target. (Shift+Click to multi-select)</span>
               <button onClick={() => setSelectedFixtureIds(movableFixtures.map(f => f.id))} className="px-2 py-2 border border-cyan/30 text-cyan-500 hover:bg-cyan/10 uppercase tracking-widest text-[9px]">Select All</button>
             </div>
           ) : (
             <div className="border border-[#00f2ff]/30 p-4 bg-[#00f2ff]/5 flex flex-col gap-4">
               <h3 className="text-[10px] text-[#00f2ff] tracking-widest border-b border-[#00f2ff]/20 pb-2">
                 {selectedFixtureIds.length === 1 ? selectedFixtureIds[0].toUpperCase() : `MULTIPLE SELECTED (${selectedFixtureIds.length})`}
               </h3>
               
               <div className="flex gap-2">
                 <button onClick={() => setSelectedFixtureIds(movableFixtures.map(f => f.id))} className="flex-1 px-2 py-1.5 border border-cyan/30 text-cyan-500 hover:bg-cyan/10 uppercase tracking-widest text-[9px]">Select All</button>
                 <button onClick={() => setSelectedFixtureIds([])} className="flex-1 px-2 py-1.5 border border-gray-600 text-gray-400 hover:bg-gray-800 uppercase tracking-widest text-[9px]">Deselect</button>
               </div>

               <div className="flex gap-2">
                 <button 
                   onClick={() => {
                     let allActive = true;
                     selectedFixtureIds.forEach(id => {
                        if (!engine.planOverrides[id] || !engine.planOverrides[id].active) allActive = false;
                     });
                     selectedFixtureIds.forEach(id => {
                        if (!engine.planOverrides[id]) {
                           engine.planOverrides[id] = { active: !allActive, pan: 32768, tilt: 32768, frost: false };
                        } else {
                           engine.planOverrides[id].active = !allActive;
                        }
                     });
                     // Force re-render
                     setSelectedFixtureIds([...selectedFixtureIds]);
                   }}
                   className={`flex-1 p-2 text-[10px] border uppercase transition-colors ${
                     selectedFixtureIds.every(id => engine.planOverrides[id]?.active) 
                     ? 'bg-cyan-500/20 border-[#00f2ff] text-[#00f2ff]' : 'border-gray-600 text-gray-500 hover:text-white'
                   }`}
                 >
                   {selectedFixtureIds.every(id => engine.planOverrides[id]?.active) ? 'Target Lock: ON' : 'Target Lock: OFF'}
                 </button>
               </div>

               <div className="flex flex-col gap-2 pt-2">
                 <span className="text-[9px] text-gray-400">Beam Effect (雾化/光束)</span>
                 <div className="flex gap-2">
                   <button 
                     onClick={() => setFrost(false)}
                     className={`flex-1 p-1.5 text-[9px] border uppercase transition-colors ${!frost ? 'bg-cyan-500/20 border-[#00f2ff] text-[#00f2ff]' : 'border-gray-600 text-gray-500 hover:text-white'}`}
                   >
                     Beam
                   </button>
                   <button 
                     onClick={() => setFrost(true)}
                     className={`flex-1 p-1.5 text-[9px] border uppercase transition-colors ${frost ? 'bg-orange-500/20 border-[#f27d26] text-[#f27d26]' : 'border-gray-600 text-gray-500 hover:text-white'}`}
                   >
                     Frost
                   </button>
                 </div>
               </div>

               <div className="text-[9px] text-gray-400 mt-2 leading-relaxed">
                 When Target Lock is ON, this fixture ignores music sync and holds coordinates until deactivated or this window is closed. (Plan view supports Spot/Beam only).
               </div>
             </div>
           )}
        </div>
      </div>
    </motion.div>
  );
}
