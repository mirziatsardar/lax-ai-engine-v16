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
  
  udpClient.bind(0, () => {
    udpClient.setBroadcast(true);
    try {
      // sACN Multicast needs a higher TTL to jump through routers/switches
      udpClient.setMulticastTTL(32);
      udpClient.setMulticastLoopback(true);
    } catch(e) { /* Some OS might not allow this without admin */ }
    console.log("UDP DMX Relay Socket Ready");
  });

  const sacnSequences: Record<number, number> = {};
  const CID = Buffer.from([0x4c, 0x41, 0x58, 0x2d, 0x41, 0x49, 0x2d, 0x56, 0x31, 0x36, 0x2d, 0x4e, 0x4f, 0x44, 0x45, 0x21]); // "LAX-AI-V16-NODE!"

  io.on("connection", (socket) => {
    console.log("DMX Engine Link Established:", socket.id);

    socket.on("dmx_frame", (data: { 
      universe: number; 
      buffer: number[]; 
      targetIp?: string; 
      protocol?: string;
      sacnMulticast?: string;
      interface?: string
    }) => {
      try {
        const dmxBuffer = Buffer.from(data.buffer);
        const protocol = data.protocol || "Art-Net";
        
        let target = data.targetIp;
        if (!target) {
          if (protocol === "Art-Net") {
            target = "255.255.255.255";
          } else {
            // Standard sACN Multicast address formula
            const h = Math.floor(data.universe / 256);
            const l = data.universe % 256;
            target = `239.255.${h}.${l}`;
          }
        }
        
        if (data.interface && data.interface !== "Default") {
          try {
            if (data.interface.includes('.')) {
              udpClient.setMulticastInterface(data.interface);
            }
          } catch (e) { /* ignore */ }
        }

        if (protocol === "Art-Net") {
          // RFC Art-Net 4 Header
          const artnetPacket = Buffer.alloc(18 + 512);
          artnetPacket.write("Art-Net\0", 0);
          artnetPacket.writeUInt16LE(0x5000, 8); // OpOutput
          artnetPacket.writeUInt16BE(14, 10);     // Proto Version
          artnetPacket.writeUInt8(0, 12);         // Sequence (0 to disable)
          artnetPacket.writeUInt8(0, 13);         // Physical
          
          // Art-Net Universe mapping (Port Address)
          // 0-indexed port address 15 bits
          const outputUni = data.universe > 0 ? (data.universe - 1) & 0x7FFF : 0;
          artnetPacket.writeUInt16LE(outputUni, 14);
          
          artnetPacket.writeUInt16BE(512, 16);    // Length
          dmxBuffer.copy(artnetPacket, 18);

          udpClient.send(artnetPacket, 6454, target);
        } else if (protocol === "sACN") {
          // ANSI E1.31-2016 Compliant Header
          const sacnPacket = Buffer.alloc(126 + 512);
          
          // Root Layer (38 bytes)
          sacnPacket.writeUInt16BE(0x0010, 0); // Preamble Size
          sacnPacket.writeUInt16BE(0x0000, 2); // Postamble Size
          sacnPacket.write("ASC-E1.17\0\0\0", 4); // ACN Packet ID
          sacnPacket.writeUInt16BE(0x7000 | (638 - 16), 16); // Flags and Length (Root Layer)
          sacnPacket.writeUInt32BE(0x00000004, 18); // Root Vector (Root Packet)
          CID.copy(sacnPacket, 22); // CID

          // E1.31 Framing Layer (77 bytes)
          sacnPacket.writeUInt16BE(0x7000 | (638 - 38), 38); // Flags and Length (Framing Layer)
          sacnPacket.writeUInt32BE(0x00000002, 40); // E1.31 Vector
          sacnPacket.write("LAX-AI-ENGINE-V16".padEnd(32, "\0"), 44); // Source Name
          sacnPacket.writeUInt8(100, 76); // Priority
          sacnPacket.writeUInt16BE(0x0000, 77); // Synchronization Address (0 = ignore)
          
          const seq = (sacnSequences[data.universe] || 0);
          sacnPacket.writeUInt8(seq, 79); // Sequence Number
          sacnSequences[data.universe] = (seq + 1) % 256;
          
          sacnPacket.writeUInt8(0, 80); // Options (bit 6 = preview, bit 7 = stream terminated)
          sacnPacket.writeUInt16BE(data.universe, 81); // Universe

          // DMP Layer (43 bytes)
          sacnPacket.writeUInt16BE(0x7000 | (638 - 115), 115); // Flags and Length (DMP Layer)
          sacnPacket.writeUInt8(0x02, 117); // DMP Vector (Set Property Values)
          sacnPacket.writeUInt8(0xa1, 118); // Address Type & Data Type
          sacnPacket.writeUInt16BE(0x0000, 119); // First Property Address
          sacnPacket.writeUInt16BE(0x0001, 121); // Address Increment
          sacnPacket.writeUInt16BE(513, 123); // Property Value Count (1 start code + 512 channels)
          sacnPacket.writeUInt8(0, 125); // DMX Start Code (0xFF for DMX)
          
          dmxBuffer.copy(sacnPacket, 126);

          udpClient.send(sacnPacket, 5568, target);
        }
      } catch (err) {
        console.error("DMX Frame Processing Error:", err);
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
