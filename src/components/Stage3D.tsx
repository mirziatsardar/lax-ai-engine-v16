import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ActiveFixture } from '../types';
import { DMXEngine } from '../lib/dmxEngine';
import { motion, useDragControls } from 'motion/react';
import { X, Move, Box, Maximize } from 'lucide-react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, TransformControls, Grid, Line } from '@react-three/drei';
import * as THREE from 'three';

interface Stage3DProps {
  fixtures: ActiveFixture[];
  engine: DMXEngine;
  onClose: () => void;
}

// Coordinate system: Y is up. Room floor is Y=0.
// Origin (0,0,0) is center of floor.

interface Fixture3DPosition {
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

export function Stage3D({ fixtures, engine, onClose }: Stage3DProps) {
  const dragControls = useDragControls();
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [frost, setFrost] = useState(false);
  const [staticColor, setStaticColor] = useState<number | undefined>(undefined);
  const [staticGobo, setStaticGobo] = useState<number | undefined>(undefined);
  const [snapToGrid, setSnapToGrid] = useState(true);
  
  // Room dimensions
  const [roomSize, setRoomSize] = useState<[number, number, number]>(() => {
    const saved = localStorage.getItem('lax_room_size_3d');
    if (saved) return JSON.parse(saved);
    return [10, 5, 10]; // width(x), height(y), depth(z)
  });

  const updateRoomSize = (newSize: [number, number, number]) => {
    setRoomSize(newSize);
    localStorage.setItem('lax_room_size_3d', JSON.stringify(newSize));
  };

  // Track fixture positions visually 
  const [fixturePositions, setFixturePositions] = useState<Record<string, Fixture3DPosition>>({});

  useEffect(() => {
    engine.planModeActive = true;
    return () => {
      engine.planModeActive = false;
    };
  }, [engine]);

  const movableFixtures = useMemo(() => 
    fixtures.filter(f => f.type === 'spot'),
    [fixtures]
  );

  useEffect(() => {
    const savedPos = localStorage.getItem('lax_fixture_pos_3d');
    const poss: Record<string, Fixture3DPosition> = savedPos ? JSON.parse(savedPos) : {};
    
    let needsSave = false;
    movableFixtures.forEach((f, i) => {
      if (!poss[f.id]) {
        const w = roomSize[0];
        const h = roomSize[1];
        const d = roomSize[2];

        // Spread by default
        let x = (i - movableFixtures.length / 2) * (w / Math.max(1, movableFixtures.length));
        let y = h;
        let z = 0;

        let rx = 0; let ry = 0; let rz = 0;

        if (f.position?.includes('Left')) {
          x = -w * 0.3;
        } else if (f.position?.includes('Right')) {
          x = w * 0.3;
        }

        if (f.position?.includes('Floor')) {
          y = 0;
          rx = Math.PI; // Face up
        } else if (f.position?.includes('Ceiling')) {
          y = h;
          // default face down
        } else if (f.position?.includes('Wall')) {
          y = h / 2;
          z = -d * 0.4;
          rx = Math.PI / 2; // Face forward
        }

        poss[f.id] = { x, y, z, rx, ry, rz };
        needsSave = true;
      } else {
        // Clamp existing to bounds
        let p = poss[f.id];
        let clampedX = Math.max(-roomSize[0] / 2, Math.min(roomSize[0] / 2, p.x));
        let clampedY = Math.max(0, Math.min(roomSize[1], p.y));
        let clampedZ = Math.max(-roomSize[2] / 2, Math.min(roomSize[2] / 2, p.z));
        if (clampedX !== p.x || clampedY !== p.y || clampedZ !== p.z || p.rx === undefined) {
          poss[f.id] = { x: clampedX, y: clampedY, z: clampedZ, rx: p.rx || 0, ry: p.ry || 0, rz: p.rz || 0 };
          needsSave = true;
        }
      }
    });

    setFixturePositions(poss);
    if (needsSave) {
      localStorage.setItem('lax_fixture_pos_3d', JSON.stringify(poss));
    }
  }, [movableFixtures, roomSize]);

  // Handle target calculation
  // Assume fixture hangs from ceiling pointing down (-Y).
  // Pan rotates around Y axis.
  // Tilt rotates from Straight Down (0 tilt) to Horizontal (90 deg tilt) to Up (180 deg tilt).
  // Some fixtures have different resting orientations. We'll assume a standard moving head logic:
  // Base is -Y. Pan 0 = base forward. 540 max.
  const handleAim = (targetPoint: THREE.Vector3) => {
    if (selectedFixtureIds.length === 0) return;

    selectedFixtureIds.forEach(id => {
       const pos = fixturePositions[id];
       if (!pos) return;

       // Vector from fixture to target
       let dx = targetPoint.x - pos.x;
       let dy = targetPoint.y - pos.y;
       let dz = targetPoint.z - pos.z;

       // Convert vector to fixture's local space based on its rotation
       if (pos.rx || pos.ry || pos.rz) {
          const euler = new THREE.Euler(pos.rx || 0, pos.ry || 0, pos.rz || 0, 'XYZ');
          const vec = new THREE.Vector3(dx, dy, dz);
          vec.applyEuler(new THREE.Euler(-euler.x, -euler.y, -euler.z, 'ZYX')); // Inverse rotation
          dx = vec.x;
          dy = vec.y;
          dz = vec.z;
       }

       const distSum = Math.sqrt(dx*dx + dy*dy + dz*dz);
       if (distSum === 0) return;

       const currentPan16 = engine.planOverrides[id]?.pan ?? 32768;
       const currentTilt16 = engine.planOverrides[id]?.tilt ?? 32768;
       
       const currentAlpha = ((currentPan16 / 65535) - 0.5) * (Math.PI * 3);
       const currentBeta = ((currentTilt16 / 65535) - 0.5) * (Math.PI * 1.5);

       // Base beta (always positive)
       // dy should ideally be negative (floor is below fixture)
       let baseBeta = Math.acos(-dy / distSum); 

       // Two kinematic solutions
       let alphaA = Math.atan2(-dz, dx);
       let betaA = baseBeta;

       let alphaB = Math.atan2(dz, -dx);
       let betaB = -baseBeta;

       const unwrap = (target: number, current: number) => {
           let diff = target - current;
           while (diff > Math.PI) diff -= 2 * Math.PI;
           while (diff < -Math.PI) diff += 2 * Math.PI;
           return current + diff;
       };

       alphaA = unwrap(alphaA, currentAlpha);
       alphaB = unwrap(alphaB, currentAlpha);

       const distA = Math.abs(alphaA - currentAlpha) + Math.abs(betaA - currentBeta);
       const distB = Math.abs(alphaB - currentAlpha) + Math.abs(betaB - currentBeta);

       let bestAlpha = alphaA;
       let bestBeta = betaA;
       if (distB < distA) {
           bestAlpha = alphaB;
           bestBeta = betaB;
       }

       let panNorm = 0.5 + (bestAlpha / (Math.PI * 3));
       let tiltNorm = 0.5 + (bestBeta / (Math.PI * 1.5));

       // Clamp
       panNorm = Math.max(0, Math.min(1, panNorm));
       tiltNorm = Math.max(0, Math.min(1, tiltNorm));

       const pan16 = Math.floor(panNorm * 65535);
       const tilt16 = Math.floor(tiltNorm * 65535);

       if (!engine.planOverrides[id]) {
         engine.planOverrides[id] = { active: true, pan: pan16, tilt: tilt16, frost, color: staticColor, gobo: staticGobo };
       } else {
         engine.planOverrides[id].pan = pan16;
         engine.planOverrides[id].tilt = tilt16;
         engine.planOverrides[id].frost = frost;
         engine.planOverrides[id].color = staticColor;
         engine.planOverrides[id].gobo = staticGobo;
       }
    });

    setFrost(f => f); 
  };

  const updateFixturePos = (id: string, newPos: Fixture3DPosition) => {
     setFixturePositions(prev => {
       const clamped = {
         x: Math.max(-roomSize[0] / 2, Math.min(roomSize[0] / 2, newPos.x)),
         y: Math.max(0, Math.min(roomSize[1], newPos.y)),
         z: Math.max(-roomSize[2] / 2, Math.min(roomSize[2] / 2, newPos.z)),
         rx: newPos.rx ?? prev[id]?.rx ?? 0,
         ry: newPos.ry ?? prev[id]?.ry ?? 0,
         rz: newPos.rz ?? prev[id]?.rz ?? 0,
       };
       const next = { ...prev, [id]: clamped };
       localStorage.setItem('lax_fixture_pos_3d', JSON.stringify(next));
       return next;
     });
  };

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
        top: '5%',
        left: '5%',
        width: '90%',
        maxWidth: '1200px',
        zIndex: 50,
      }}
      className="bg-[#0a0a0a] border border-[#00f2ff]/50 shadow-2xl shadow-cyan-900/20 rounded-sm flex flex-col font-mono"
    >
      <div 
        onPointerDown={(e) => dragControls.start(e)}
        className="h-10 border-b border-[#00f2ff]/20 bg-[#00f2ff]/5 flex items-center justify-between px-4 cursor-move"
      >
        <div className="flex items-center gap-3">
          <Box size={14} className="text-[#00f2ff]" />
          <h2 className="text-xs uppercase tracking-[0.3em] font-mono text-[#00f2ff] font-bold">Stage 3D (3D环境模型)</h2>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="text-cyan-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="p-4 flex gap-6 h-[600px]">
        {/* Left Side: Canvas */}
        <div className="flex-1 border border-cyan/20 bg-black relative rounded overflow-hidden">
          <Canvas camera={{ position: [0, roomSize[1] + 2, roomSize[2] + 2], fov: 50 }}>
            <ambientLight intensity={0.5} />
            <OrbitControls makeDefault />
            <Grid infiniteGrid fadeDistance={40} sectionColor="#00f2ff" cellColor="#00f2ff" sectionSize={1} cellSize={0.5} opacity={0.2} />
            
            {/* Room Bounds Visualization */}
            <mesh position={[0, roomSize[1]/2, 0]}>
              <boxGeometry args={roomSize} />
              <meshBasicMaterial color="#00f2ff" wireframe transparent opacity={0.05} />
            </mesh>
            
            {/* Clickable Floor */}
            <mesh 
              rotation={[-Math.PI / 2, 0, 0]} 
              position={[0, 0, 0]}
              onPointerDown={(e) => {
                 e.stopPropagation();
                 handleAim(e.point);
              }}
            >
              <planeGeometry args={[roomSize[0], roomSize[2]]} />
              <meshBasicMaterial visible={false} />
            </mesh>

            {/* Clickable Walls */}
            {/* Back Wall */}
            <mesh 
              position={[0, roomSize[1]/2, -roomSize[2]/2]}
              onPointerDown={(e) => { e.stopPropagation(); handleAim(e.point); }}
            >
               <planeGeometry args={[roomSize[0], roomSize[1]]} />
               <meshBasicMaterial visible={false} />
            </mesh>
            {/* Left Wall */}
            <mesh 
              position={[-roomSize[0]/2, roomSize[1]/2, 0]}
              rotation={[0, Math.PI/2, 0]}
              onPointerDown={(e) => { e.stopPropagation(); handleAim(e.point); }}
            >
               <planeGeometry args={[roomSize[2], roomSize[1]]} />
               <meshBasicMaterial visible={false} />
            </mesh>
             {/* Right Wall */}
             <mesh 
              position={[roomSize[0]/2, roomSize[1]/2, 0]}
              rotation={[0, -Math.PI/2, 0]}
              onPointerDown={(e) => { e.stopPropagation(); handleAim(e.point); }}
            >
               <planeGeometry args={[roomSize[2], roomSize[1]]} />
               <meshBasicMaterial visible={false} />
            </mesh>

            {/* Render fixture positions visually */}
            {movableFixtures.map((f, i) => {
                const pos = fixturePositions[f.id];
                if (!pos) return null;
                const isSelected = selectedFixtureIds.includes(f.id);
                const isOverrideActive = engine.planOverrides[f.id]?.active;
                
                return (
                  <FixtureNode
                    key={f.id}
                    fixture={f}
                    idx={i}
                    pos={pos}
                    isSelected={isSelected}
                    isOverrideActive={isOverrideActive}
                    snapToGrid={snapToGrid}
                    ovr={engine.planOverrides[f.id]}
                    roomSize={roomSize}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (e.shiftKey) {
                         setSelectedFixtureIds(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]);
                      } else {
                         setSelectedFixtureIds([f.id]);
                      }
                    }}
                    onUpdatePos={(newPos) => updateFixturePos(f.id, newPos)}
                  />
                );
            })}
          </Canvas>
          <div className="absolute bottom-2 left-2 pointer-events-none text-[10px] text-cyan-500/70">
            Rotate: Left Click Drag | Pan: Right Click Drag | Zoom: Scroll
            <br />
            Select: Click fixture | Multi-select: Shift+Click
            <br />
            Aim: Click on grid floor or walls
          </div>
        </div>

        {/* Right Side: Options */}
        <div className="w-64 flex flex-col gap-4 overflow-auto">
           
           <div className="border border-cyan/20 p-3 bg-black">
              <h3 className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Base Direction (安装方向)</h3>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => {
                     selectedFixtureIds.forEach(id => {
                        updateFixturePos(id, { ...fixturePositions[id], rx: Math.PI, ry: 0, rz: 0 });
                     });
                  }} 
                  className="p-1.5 text-[9px] border bg-[#111] border-gray-600 text-gray-400 hover:text-white transition-colors"
                >
                  UP (向上)
                </button>
                <button 
                  onClick={() => {
                     selectedFixtureIds.forEach(id => {
                        updateFixturePos(id, { ...fixturePositions[id], rx: 0, ry: 0, rz: 0 });
                     });
                  }} 
                  className="p-1.5 text-[9px] border bg-[#111] border-gray-600 text-gray-400 hover:text-white transition-colors"
                >
                  DOWN (向下)
                </button>
                <button 
                  onClick={() => {
                     selectedFixtureIds.forEach(id => {
                        updateFixturePos(id, { ...fixturePositions[id], rx: 0, ry: 0, rz: -Math.PI/2 });
                     });
                  }} 
                  className="p-1.5 text-[9px] border bg-[#111] border-gray-600 text-gray-400 hover:text-white transition-colors"
                >
                  LEFT (向左)
                </button>
                <button 
                  onClick={() => {
                     selectedFixtureIds.forEach(id => {
                        updateFixturePos(id, { ...fixturePositions[id], rx: 0, ry: 0, rz: Math.PI/2 });
                     });
                  }} 
                  className="p-1.5 text-[9px] border bg-[#111] border-gray-600 text-gray-400 hover:text-white transition-colors"
                >
                  RIGHT (向右)
                </button>
              </div>
           </div>

           <div className="border border-cyan/20 p-3 bg-black">
              <h3 className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Zero Aim (光束归零)</h3>
              <div className="flex gap-2">
                 <button 
                   onClick={() => {
                      const targetIds = selectedFixtureIds.length > 0 ? selectedFixtureIds : fixtures.map(f => f.id);
                      targetIds.forEach(id => {
                         engine.planOverrides[id] = { ...engine.planOverrides[id], active: true, pan: 32768, tilt: 32768, color: undefined, gobo: undefined, frost: false };
                      });
                   }}
                   className="w-full p-2 text-[10px] border border-[#00f2ff] text-[#00f2ff] hover:bg-[#00f2ff]/20 transition-all font-bold tracking-widest uppercase"
                 >
                   Zero Selected/All (50% / 50%)
                 </button>
              </div>
           </div>

           <div className="border border-cyan/20 p-3 bg-black">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Space Dimensions(空间大小)</h3>
                <label className="flex items-center gap-1 text-[9px] text-cyan-500 cursor-pointer">
                  <input type="checkbox" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)} className="accent-cyan-500" />
                  Snap to Grid
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[9px]">
                <div>
                  <label className="text-cyan-600 mb-1 block">W (X)</label>
                  <input type="number" step="0.5" value={roomSize[0]} onChange={e => updateRoomSize([Number(e.target.value), roomSize[1], roomSize[2]])} className="w-full bg-cyan-900/20 border border-cyan/30 text-white p-1 text-center" />
                </div>
                <div>
                  <label className="text-cyan-600 mb-1 block">H (Y)</label>
                  <input type="number" step="0.5" value={roomSize[1]} onChange={e => updateRoomSize([roomSize[0], Number(e.target.value), roomSize[2]])} className="w-full bg-cyan-900/20 border border-cyan/30 text-white p-1 text-center" />
                </div>
                <div>
                  <label className="text-cyan-600 mb-1 block">D (Z)</label>
                  <input type="number" step="0.5" value={roomSize[2]} onChange={e => updateRoomSize([roomSize[0], roomSize[1], Number(e.target.value)])} className="w-full bg-cyan-900/20 border border-cyan/30 text-white p-1 text-center" />
                </div>
              </div>
           </div>

           <div className="border border-cyan/20 p-3 bg-black flex flex-col gap-2 max-h-48 overflow-y-auto">
              <h3 className="text-[10px] text-gray-500 uppercase tracking-widest font-bold sticky top-0 bg-black py-1 z-10">Fixture List(设备列表)</h3>
              <div className="flex flex-col gap-1">
                {movableFixtures.map(f => (
                  <button 
                    key={f.id}
                    onClick={(e) => {
                       if (e.shiftKey) {
                           setSelectedFixtureIds(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]);
                       } else {
                           setSelectedFixtureIds([f.id]);
                       }
                    }}
                    className={`text-left px-2 py-1.5 text-[9px] border transition-colors truncate ${selectedFixtureIds.includes(f.id) ? 'bg-cyan-500/20 border-[#00f2ff] text-[#00f2ff]' : 'border-gray-800 text-gray-400 hover:border-cyan/50 hover:bg-cyan/10'}`}
                  >
                    U{f.universe}.{f.addr} - {f.name}
                  </button>
                ))}
              </div>
           </div>

           {selectedFixtureIds.length === 0 ? (
             <div className="flex flex-col gap-4 text-[10px] text-gray-500 border border-gray-800 p-4 text-center">
               <span>Select a fixture from the list or 3D view to override and target.</span>
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
                     onClick={() => {
                        setFrost(false);
                        selectedFixtureIds.forEach(id => {
                           if(engine.planOverrides[id]) engine.planOverrides[id].frost = false;
                        });
                     }}
                     className={`flex-1 p-1.5 text-[9px] border uppercase transition-colors ${!frost ? 'bg-cyan-500/20 border-[#00f2ff] text-[#00f2ff]' : 'border-gray-600 text-gray-500 hover:text-white'}`}
                   >
                     Beam
                   </button>
                   <button 
                     onClick={() => {
                        setFrost(true);
                        selectedFixtureIds.forEach(id => {
                           if(engine.planOverrides[id]) engine.planOverrides[id].frost = true;
                        });
                     }}
                     className={`flex-1 p-1.5 text-[9px] border uppercase transition-colors ${frost ? 'bg-orange-500/20 border-[#f27d26] text-[#f27d26]' : 'border-gray-600 text-gray-500 hover:text-white'}`}
                   >
                     Frost
                   </button>
                 </div>
               </div>

               <div className="flex flex-col gap-2 pt-2">
                 <div className="flex justify-between">
                    <span className="text-[9px] text-gray-400">Color (颜色)</span>
                    <button 
                      onClick={() => {
                         setStaticColor(undefined);
                         selectedFixtureIds.forEach(id => {
                           if(engine.planOverrides[id]) engine.planOverrides[id].color = undefined;
                         });
                      }}
                      className="text-[9px] text-gray-500 border border-gray-700 px-1 hover:text-white"
                    >Audio</button>
                 </div>
                 <div className="flex flex-wrap gap-1">
                   {[{n:'W', c: 0}, {n:'R', c: 9}, {n:'Y', c: 18}, {n:'B', c: 27}, {n:'G', c: 36}, {n:'P', c: 45}, {n:'O', c: 54}, {n:'C', c: 63}].map(clr => (
                     <button
                       key={clr.c}
                       onClick={() => {
                          setStaticColor(clr.c);
                          selectedFixtureIds.forEach(id => {
                             if(engine.planOverrides[id]) engine.planOverrides[id].color = clr.c;
                          });
                       }}
                       className={`w-6 h-6 text-[9px] border transition-colors ${staticColor === clr.c ? 'border-white text-white' : 'border-gray-700 text-gray-500'}`}
                     >{clr.n}</button>
                   ))}
                 </div>
               </div>

               <div className="flex flex-col gap-2 pt-2">
                 <div className="flex justify-between">
                    <span className="text-[9px] text-gray-400">Gobo (图案)</span>
                    <button 
                      onClick={() => {
                         setStaticGobo(undefined);
                         selectedFixtureIds.forEach(id => {
                           if(engine.planOverrides[id]) engine.planOverrides[id].gobo = undefined;
                         });
                      }}
                      className="text-[9px] text-gray-500 border border-gray-700 px-1 hover:text-white"
                    >Audio</button>
                 </div>
                 <input 
                   type="range" min="0" max="15" step="1" 
                   value={staticGobo ?? 0}
                   onChange={e => {
                      const val = parseInt(e.target.value);
                      setStaticGobo(val);
                      selectedFixtureIds.forEach(id => {
                         if(engine.planOverrides[id]) engine.planOverrides[id].gobo = val;
                      });
                   }}
                   className="w-full accent-[#00f2ff]"
                 />
               </div>

               <div className="text-[9px] text-gray-400 mt-2 leading-relaxed">
                 Use the transform gizmo on the selected fixture to adjust its mounting position (XYZ). Click the floor to aim locked fixtures.
               </div>
             </div>
           )}
        </div>
      </div>
    </motion.div>
  );
}

// Subcomponent for each fixture body and its target line
function FixtureNode({ fixture, idx, pos, isSelected, isOverrideActive, snapToGrid, ovr, roomSize, onClick, onUpdatePos }: any) {
  const transformRef = useRef<any>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  // Re-calculate the theoretical beam target line using actual engine state
  // Even if not active override, drawing a small beam helps.
  const p = ovr ? ovr.pan : 32768;
  const t = ovr ? ovr.tilt : 32768;

  // Inverse trig mapping from earlier:
  // panNorm = 0.5 + (panAngle / (Math.PI * 3))
  // panAngle = (panNorm - 0.5) * Math.PI * 3
  const panNorm = p / 65535;
  const tiltNorm = t / 65535;
  const panAngle = (panNorm - 0.5) * Math.PI * 3;
  const tiltAngle = (tiltNorm - 0.5) * Math.PI * 1.5;

  // Direction vector. Base points -Y.
  const distance = 15; // beam render dist
  const dirY = -Math.cos(tiltAngle); 
  const r = Math.sin(tiltAngle);
  const dirX = r * Math.cos(panAngle);
  const dirZ = -r * Math.sin(panAngle);

  const targetPoint = new THREE.Vector3(pos.x + dirX * distance, pos.y + dirY * distance, pos.z + dirZ * distance);
  const points = [new THREE.Vector3(pos.x, pos.y, pos.z), targetPoint];

  return (
    <>
      {isSelected && (
        <TransformControls 
           object={meshRef as any} 
           mode="translate" 
           size={0.6}
           translationSnap={snapToGrid ? 0.5 : null}
           onMouseUp={(e) => {
              if (meshRef.current) {
                onUpdatePos({
                  x: meshRef.current.position.x,
                  y: meshRef.current.position.y,
                  z: meshRef.current.position.z,
                  rx: pos.rx,
                  ry: pos.ry,
                  rz: pos.rz,
                });
              }
           }}
        />
      )}
      <mesh 
        ref={meshRef} 
        position={[pos.x, pos.y, pos.z]} 
        rotation={[pos.rx || 0, pos.ry || 0, pos.rz || 0]}
        onClick={onClick}
      >
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color={isSelected ? "#ffffff" : isOverrideActive ? "#00f2ff" : "#333"} />
        
        {/* Draw lines */}
        {isOverrideActive && (
          <Line 
            points={[new THREE.Vector3(0,0,0), new THREE.Vector3(dirX * distance, dirY * distance, dirZ * distance)]} 
            color={ovr.frost ? "white" : "#00f2ff"} 
            lineWidth={ovr.frost ? 10 : 2}
            transparent
            opacity={0.6}
          />
        )}
      </mesh>
    </>
  );
}

