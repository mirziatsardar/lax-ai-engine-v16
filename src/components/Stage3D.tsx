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
}

export function Stage3D({ fixtures, engine, onClose }: Stage3DProps) {
  const dragControls = useDragControls();
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [frost, setFrost] = useState(false);
  
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

        if (f.position?.includes('Left')) {
          x = -w * 0.3;
        } else if (f.position?.includes('Right')) {
          x = w * 0.3;
        }

        if (f.position?.includes('Floor')) {
          y = 0;
        } else if (f.position?.includes('Ceiling')) {
          y = h;
        } else if (f.position?.includes('Wall')) {
          y = h / 2;
          z = -d * 0.4;
        }

        poss[f.id] = { x, y, z };
        needsSave = true;
      } else {
        // Clamp existing to bounds
        let p = poss[f.id];
        let clampedX = Math.max(-roomSize[0] / 2, Math.min(roomSize[0] / 2, p.x));
        let clampedY = Math.max(0, Math.min(roomSize[1], p.y));
        let clampedZ = Math.max(-roomSize[2] / 2, Math.min(roomSize[2] / 2, p.z));
        if (clampedX !== p.x || clampedY !== p.y || clampedZ !== p.z) {
          poss[f.id] = { x: clampedX, y: clampedY, z: clampedZ };
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
       const dx = targetPoint.x - pos.x;
       const dy = targetPoint.y - pos.y;
       const dz = targetPoint.z - pos.z;

       // Math for moving head:
       // Hanging fixture: base normal is +Y. Head rest points -Y.
       // Pan = angle in XZ plane.
       const panAngle = Math.atan2(dx, dz); // -PI to PI
       
       // Normalized pan (0 to 1, mapped from -270 to +270 deg = 540 deg total range = Math.PI * 3)
       let panNorm = 0.5 + (panAngle / (Math.PI * 3)); 
       if (panNorm < 0) panNorm += 1;
       if (panNorm > 1) panNorm -= 1;

       // Tilt = angle from down vector (-Y)
       const horizontalDist = Math.sqrt(dx*dx + dz*dz);
       const tiltAngle = Math.atan2(horizontalDist, -dy); // 0 (straight down) to PI (straight up)
       
       // Assuming 270 deg tilt range (Math.PI * 1.5)
       const tiltNorm = tiltAngle / (Math.PI * 1.5); 

       const pan16 = Math.max(0, Math.min(65535, Math.floor(panNorm * 65535)));
       const tilt16 = Math.max(0, Math.min(65535, Math.floor(tiltNorm * 65535)));

       if (!engine.planOverrides[id]) {
         engine.planOverrides[id] = { active: true, pan: pan16, tilt: tilt16, frost };
       } else {
         engine.planOverrides[id].pan = pan16;
         engine.planOverrides[id].tilt = tilt16;
         engine.planOverrides[id].frost = frost;
       }
    });

    // We just force a state update so React rerenders the UI (frost toggle isn't strictly needed to change here but we can trigger re-render)
    setFrost(f => f); 
  };

  const updateFixturePos = (id: string, newPos: Fixture3DPosition) => {
     setFixturePositions(prev => {
       const clamped = {
         x: Math.max(-roomSize[0] / 2, Math.min(roomSize[0] / 2, newPos.x)),
         y: Math.max(0, Math.min(roomSize[1], newPos.y)),
         z: Math.max(-roomSize[2] / 2, Math.min(roomSize[2] / 2, newPos.z)),
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
              <h3 className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 font-bold">Space Dimensions(空间大小)</h3>
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

           {selectedFixtureIds.length === 0 ? (
             <div className="flex flex-col gap-4 text-[10px] text-gray-500 border border-gray-800 p-4 text-center">
               <span>Select a fixture from the 3D view to override and target.</span>
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
function FixtureNode({ fixture, idx, pos, isSelected, isOverrideActive, ovr, roomSize, onClick, onUpdatePos }: any) {
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
  const tiltAngle = tiltNorm * Math.PI * 1.5;

  // Direction vector. Base points -Y.
  const distance = 15; // beam render dist
  const dirY = -Math.cos(tiltAngle); 
  const r = Math.sin(tiltAngle);
  const dirX = Math.sin(panAngle) * r;
  const dirZ = Math.cos(panAngle) * r;

  const targetPoint = new THREE.Vector3(pos.x + dirX * distance, pos.y + dirY * distance, pos.z + dirZ * distance);
  const points = [new THREE.Vector3(pos.x, pos.y, pos.z), targetPoint];

  return (
    <>
      {isSelected && (
        <TransformControls 
           object={meshRef as any} 
           mode="translate" 
           size={0.6}
           onMouseUp={(e) => {
              if (meshRef.current) {
                onUpdatePos({
                  x: meshRef.current.position.x,
                  y: meshRef.current.position.y,
                  z: meshRef.current.position.z,
                });
              }
           }}
        />
      )}
      <mesh 
        ref={meshRef} 
        position={[pos.x, pos.y, pos.z]} 
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

