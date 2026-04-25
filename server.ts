import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import dgram from "dgram";

import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;
  const udpClient = dgram.createSocket("udp4");
  
  udpClient.on('error', (err) => {
    console.error("UDP Socket Error:", err);
  });
  
  udpClient.bind(0, "0.0.0.0", () => {
    udpClient.setBroadcast(true);
    udpClient.setMulticastTTL(64);
    udpClient.setMulticastLoopback(true);
    console.log("UDP DMX Relay Socket Ready");
  });

  const sacnSequences: Record<number, number> = {};
  let totalPacketsSent = 0;

  io.on("connection", (socket) => {
    console.log("DMX Engine Link Established:", socket.id);
    socket.emit("activity_log", "Connection established with DMX Engine.");

    socket.on("dmx_frame", (data: { universe: number; buffer: number[]; targetIp?: string; protocol?: string }) => {
      try {
        const dmxBuffer = Buffer.from(data.buffer);
        const protocol = data.protocol || "Art-Net";
        
        // Match Python's target selection precisely
        let target = data.targetIp;
        if (!target || target.toLowerCase() === "multicast" || target.toLowerCase() === "broadcast" || target === "") {
          if (protocol === "Art-Net") {
            target = "255.255.255.255";
          } else {
            // Standard sACN Multicast: 239.255.msb.lsb
            const hi = Math.floor(data.universe / 256);
            const lo = data.universe % 256;
            target = `239.255.${hi}.${lo}`;
          }
        }

        if (protocol === "Art-Net") {
          // Exactly as python: b'Art-Net\x00' + OpCode(0x5000 LE) + ProtVer(14 BE) + Seq(0) + Phys(0) + Uni(LE) + Len(512 BE)
          const artnetPacket = Buffer.alloc(18 + 512);
          artnetPacket.write("Art-Net\0", 0);
          artnetPacket.writeUInt16LE(0x5000, 8);
          artnetPacket.writeUInt16BE(14, 10);
          artnetPacket.writeUInt8(0, 12); // Sequence
          artnetPacket.writeUInt8(0, 13); // Physical
          
          const outputUni = data.universe > 0 ? data.universe - 1 : 0;
          artnetPacket.writeUInt16LE(outputUni, 14);
          artnetPacket.writeUInt16BE(512, 16);
          dmxBuffer.copy(artnetPacket, 18);

          udpClient.send(artnetPacket, 6454, target);
        } else if (protocol === "sACN") {
          const sacnPacket = Buffer.alloc(126 + 512);
          const totalLen = sacnPacket.length;
          
          sacnPacket.writeUInt16BE(0x0010, 0);
          sacnPacket.writeUInt16BE(0x0000, 2);
          sacnPacket.write("ASC-E1.17\0\0\0", 4);
          sacnPacket.writeUInt16BE(0x7000 | (totalLen - 16), 16);
          sacnPacket.writeUInt32BE(0x00000004, 18);
          
          const cid = Buffer.alloc(16);
          cid.write("LAX-AI-V16-ENGINE", 0); // 16 bytes GUID (placeholder)
          cid.copy(sacnPacket, 22);

          sacnPacket.writeUInt16BE(0x7000 | (totalLen - 38), 38);
          sacnPacket.writeUInt32BE(0x00000002, 40);
          
          const sourceName = Buffer.alloc(32);
          sourceName.write("LAX AI ENGINE V16", 0);
          sourceName.copy(sacnPacket, 44);
          
          sacnPacket.writeUInt8(100, 76);
          sacnPacket.writeUInt16BE(0, 77); // Sync Address
          
          const seq = (sacnSequences[data.universe] || 0);
          sacnPacket.writeUInt8(seq, 79);
          sacnSequences[data.universe] = (seq + 1) % 256;
          
          sacnPacket.writeUInt8(0, 80);
          sacnPacket.writeUInt16BE(data.universe, 81);

          sacnPacket.writeUInt16BE(0x7000 | (totalLen - 115), 115);
          sacnPacket.writeUInt8(0x02, 117);
          sacnPacket.writeUInt8(0xa1, 118);
          sacnPacket.writeUInt16BE(0x0000, 119);
          sacnPacket.writeUInt16BE(0x0001, 121);
          sacnPacket.writeUInt16BE(513, 123);
          sacnPacket.writeUInt8(0x00, 125);
          dmxBuffer.copy(sacnPacket, 126);

          udpClient.send(sacnPacket, 5568, target);
        }

        totalPacketsSent++;
        if (totalPacketsSent % 200 === 0) {
          socket.emit("activity_log", `Relayed ${totalPacketsSent} packets. Last to: ${target}`);
        }
      } catch (err) {
        if (err instanceof Error) {
          socket.emit("activity_log", `Error: ${err.message}`);
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("DMX Engine Link Terminated");
    });
  });

  // API routes
  app.get("/api/status", (req, res) => {
    res.json({ 
      engine: "LAX NEURAL CORE V16.0",
      status: "ONLINE",
      uptime: process.uptime()
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, locate 'dist' relative to this bundled server file
    // When bundled to dist-server/server.js, dist is at ../dist
    const distPath = path.isAbsolute(process.env.DIST_PATH || "") 
      ? process.env.DIST_PATH! 
      : path.resolve(__dirname, process.env.NODE_ENV === "production" ? "../dist" : "dist");
      
    console.log(`Static files being served from: ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      console.log(`Serving index.html from: ${indexPath}`);
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error(`Error sending index.html: ${err.message}`);
          res.status(404).send("Application files could not be located. Ensure 'dist' folder exists.");
        }
      });
    });
  }

  httpServer.on('error', (err) => {
    console.error("HTTP Server Error:", err);
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`LAX AI ENGINE running at http://localhost:${PORT}`);
  });
}

startServer();
