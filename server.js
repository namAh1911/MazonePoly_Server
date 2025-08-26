const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");

// Tắt cache cho toàn bộ response (fix 304)
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store"); 
  next();
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:19006",
      "https://mazonepoly-admin.vercel.app",
      "*"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// 🟢 Map: userId -> Set(socketIds)
const connectedUsers = new Map();
app.set("io", io);
app.set("connectedUsers", connectedUsers);

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  socket.on("register", (userId) => {
    if (!userId) return;

    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket.id);

    socket.data.userId = userId;
    socket.join(userId); // cho phép emit theo userId
    console.log(`👤 Registered user ${userId} with socket ${socket.id}`);
  });

  socket.on("disconnect", () => {
    const userId = socket.data?.userId;
    if (userId && connectedUsers.has(userId)) {
      const sockets = connectedUsers.get(userId);
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        connectedUsers.delete(userId);
      }
    }
    console.log("🔴 Socket disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});
