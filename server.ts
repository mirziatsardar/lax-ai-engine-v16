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
    console.log("UDP DMX Relay Socket Ready");
  });

  io.on("connection", (socket) => {
    console.log("DMX Engine Link Established:", socket.id);

  // DMX Relay Logic
  socket.on("dmx_frame", (data: { universe: number; buffer: number[]; targetIp?: string; protocol?: string }) => {
    try {
      const dmxBuffer = Buffer.from(data.buffer);
      const protocol = data.protocol || "Art-Net";
      
      if (protocol === "Art-Net") {
        const artnetPacket = Buffer.alloc(18 + 512);
        // Art-Net ID
        artnetPacket.write("Art-Net\0", 0);
        // OpCode: ArtDmx (0x5000)
        artnetPacket.writeUInt16LE(0x5000, 8);
        // ProtVer: 14
        artnetPacket.writeUInt16BE(14, 10);
        // Sequence (0 for now)
        artnetPacket.writeUInt8(0, 12);
        // Physical (0)
        artnetPacket.writeUInt8(0, 13);
        // Universe (Little Endian) - Match python's uni-1 behavior for standard compatibility
        const outputUni = data.universe > 0 ? data.universe - 1 : 0;
        artnetPacket.writeUInt16LE(outputUni, 14);
        // Length (Big Endian 512)
        artnetPacket.writeUInt16BE(512, 16);
        // DMX Data
        dmxBuffer.copy(artnetPacket, 18);

        const target = data.targetIp || process.env.ARTNET_TARGET_IP || "255.255.255.255";
        udpClient.send(artnetPacket, 6454, target, (err) => {
          if (err) console.error("Art-Net UDP Send Error:", err);
        });
      } else if (protocol === "sACN") {
        const sacnPacket = Buffer.alloc(126 + 512); // Total 638 bytes (126 header + 512 data)
        const totalLen = sacnPacket.length;
        
        // Root Layer
        sacnPacket.writeUInt16BE(0x0010, 0); // Preamble Size
        sacnPacket.writeUInt16BE(0x0000, 2); // Post-amble Size
        sacnPacket.write("ASC-E1.17\0\0\0", 4); // ACN Packet Identifier
        sacnPacket.writeUInt16BE(0x7000 | (totalLen - 16), 16); // Flags and Length (Root)
        sacnPacket.writeUInt32BE(0x00000004, 18); // Vector: Root Layer
        Buffer.from("LAX-NEURAL-CORE-V16").copy(sacnPacket, 22); // CID

        // Framing Layer
        sacnPacket.writeUInt16BE(0x7000 | (totalLen - 38), 38); // Flags and Length (Framing)
        sacnPacket.writeUInt32BE(0x00000002, 40); // Vector: Data Packet
        sacnPacket.write("LAX AI ENGINE V16".padEnd(32, "\0"), 44); // Source Name
        sacnPacket.writeUInt8(100, 76); // Priority
        sacnPacket.writeUInt16BE(0, 77); // Sync Address
        sacnPacket.writeUInt8(0, 79); // Sequence Number
        sacnPacket.writeUInt8(0, 80); // Options
        sacnPacket.writeUInt16BE(data.universe, 81); // Universe

        // DMP Layer
        sacnPacket.writeUInt16BE(0x7000 | (totalLen - 115), 115); // Flags and Length (DMP)
        sacnPacket.writeUInt8(0x02, 117); // Vector: DMP Get/Set Property
        sacnPacket.writeUInt8(0xa1, 118); // Address Type & Data Type
        sacnPacket.writeUInt16BE(0x0000, 119); // First Property Address
        sacnPacket.writeUInt16BE(0x0001, 121); // Address Increment
        sacnPacket.writeUInt16BE(513, 123); // Property value count (Start code + 512)
        sacnPacket.writeUInt8(0, 125); // Start Code
        dmxBuffer.copy(sacnPacket, 126);

        const target = data.targetIp || "239.255.0." + data.universe;
        udpClient.send(sacnPacket, 5568, target, (err) => {
          if (err) console.error("sACN UDP Send Error:", err);
        });
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
