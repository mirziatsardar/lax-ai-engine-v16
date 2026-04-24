import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import dgram from "dgram";

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
  
  // Explicitly allow broadcasting for Art-Net and sACN
  udpClient.on('error', (err) => {
    console.error("UDP Socket Error:", err);
  });
  
  // Binding is needed to set options reliably on some systems
  udpClient.bind(0, () => {
    udpClient.setBroadcast(true);
  });

  // Art-Net OpCode for ArtDmx is 0x5000 (Little Endian: 0x00, 0x50)
  // Art-Net header structure
  const ARTNET_HEADER = Buffer.from([
    0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00, // ID: Art-Net\0
    0x00, 0x50, // OpCode: ArtDmx (0x5000)
    0x00, 0x0e, // ProtVer: 14
    0x00,       // Sequence
    0x00,       // Physical
    0x00, 0x00, // SubNet + Universe (Universe 0)
    0x02, 0x00  // Length: 512 (High: 0x02, Low: 0x00)
  ]);

  io.on("connection", (socket) => {
    console.log("DMX Engine Link Established:", socket.id);

  // DMX Relay Logic
  socket.on("dmx_frame", (data: { universe: number; buffer: number[]; targetIp?: string; protocol?: string }) => {
    try {
      const dmxBuffer = Buffer.from(data.buffer);
      const protocol = data.protocol || "Art-Net";
      
      if (protocol === "Art-Net") {
        const packet = Buffer.concat([ARTNET_HEADER, dmxBuffer]);
        // Update universe in header (Bytes 14-15)
        packet[14] = data.universe & 0xFF;
        packet[15] = (data.universe >> 8) & 0xFF;

        const target = data.targetIp || process.env.ARTNET_TARGET_IP || "255.255.255.255";
        udpClient.send(packet, 6454, target, (err) => {
          if (err) console.error("Art-Net UDP Send Error:", err);
        });
      } else if (protocol === "sACN") {
        // Simple sACN (E1.31) Data Packet Construction (Full ACN Header + Root Layer + Framing Layer + DMP Layer)
        // For production, a library like 'sacn' is better, but since I am in a custom environment, I'll build a minimal packet.
        // E1.31 Packet Structure (approx 638 bytes)
        const sacnPacket = Buffer.alloc(125 + 513); // Fixed length
        
        // Root Layer (38 bytes)
        sacnPacket.writeUInt16BE(0x0010, 0); // Preamble Size
        sacnPacket.writeUInt16BE(0x0000, 2); // Post-amble Size
        sacnPacket.write("ASC-E1.17\0\0\0", 4); // ACN Packet Identifier
        sacnPacket.writeUInt16BE(0x7000 | (110 + 513), 16); // Flags and Length
        sacnPacket.writeUInt32BE(0x00000004, 18); // Vector: Root Layer
        // CID (16 bytes) - just random/static
        Buffer.from("LAX-NEURAL-CORE-V16").copy(sacnPacket, 22);

        // Framing Layer (77 bytes)
        sacnPacket.writeUInt16BE(0x7000 | (88 + 513), 38); // Flags and Length
        sacnPacket.writeUInt32BE(0x00000002, 40); // Vector: Data Packet
        sacnPacket.write("LAX AI ENGINE V16".padEnd(32, '\0'), 44); // Source Name
        sacnPacket.writeUInt8(100, 76); // Priority
        sacnPacket.writeUInt16BE(0x0000, 77); // Synchronization Address
        sacnPacket.writeUInt8(0, 79); // Sequence Number (simplified)
        sacnPacket.writeUInt8(0, 80); // Options
        sacnPacket.writeUInt16BE(data.universe, 81); // Universe

        // DMP Layer (638 bytes total start at 115)
        sacnPacket.writeUInt16BE(0x7000 | (10 + 513), 83); // Flags and Length
        sacnPacket.writeUInt8(0x02, 85); // Vector: DMP Get/Set Property
        sacnPacket.writeUInt8(0xa1, 86); // Address Type & Data Type
        sacnPacket.writeUInt16BE(0x0000, 87); // First Property Address
        sacnPacket.writeUInt16BE(0x0001, 89); // Address Increment
        sacnPacket.writeUInt16BE(513, 91); // Property value count
        sacnPacket.writeUInt8(0, 93); // Start Code
        dmxBuffer.copy(sacnPacket, 94);

        const target = data.targetIp || "239.255.0." + data.universe; // Default to multicast
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
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`LAX AI ENGINE running at http://localhost:${PORT}`);
  });
}

startServer();
