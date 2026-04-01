const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 🌟 ตัวแปรเก็บเครื่องบอท เปลี่ยนเป็นออบเจกต์ว่างๆ เพื่อให้มัน "งอก" เครื่องใหม่ได้เรื่อยๆ
const hosts = {}; 

function broadcastLiveStatus() {
    let statusData = {};
    for (let hostId in hosts) {
        statusData[hostId] = { 
            count: hosts[hostId].queue.length, 
            isProcessing: hosts[hostId].isBusy, 
            isOnline: !!hosts[hostId].socketId 
        };
    }
    // ส่งรายชื่อเครื่องบอททั้งหมดที่มีในตอนนี้ ไปให้หน้าลูกน้องอัปเดต
    io.emit('live_queue_status', statusData);
}

io.on('connection', (socket) => {
    // ทันทีที่ลูกน้องต่อเข้ามา ให้ส่งรายชื่อบอทล่าสุดไปให้เลย
    broadcastLiveStatus();

    // 🌟 เมื่อบอทฝั่งบอส (Host) เปิดหน้าต่างส่วนขยายขึ้นมา
    socket.on('register', (data) => {
        if (!data || data.role !== 'host') return;
        const hostId = data.hostId; // ดึงชื่อเครื่อง (เช่น kbiz2, kbiz_test)
        
        // ถ้าไม่เคยมีชื่อนี้มาก่อน ให้สร้างพื้นที่รอรับงานใหม่เลย!
        if (!hosts[hostId]) {
            hosts[hostId] = { socketId: null, isBusy: false, queue: [] };
        }
        
        hosts[hostId].socketId = socket.id;
        hosts[hostId].isBusy = false;
        console.log(`🟢 บอส [${hostId}] ออนไลน์พร้อมรับงาน!`);
        
        // สั่งให้ลูกน้องทุกคนอัปเดตรายชื่อ Dropdown 
        broadcastLiveStatus();
    });

    // 🌟 เมื่อลูกน้องสั่งค้นหาบัญชี
    socket.on('request_check', (data) => {
        if (!data) return;
        const system = data.system; 
        const host = hosts[system];

        // ถ้าเครื่องที่ลูกน้องเลือกปิดอยู่ ให้เด้งกลับไปด่าลูกน้อง
        if (!host || !host.socketId) {
            return socket.emit('check_result', { status: 'error', message: `❌ เครื่อง ${system} ปิดอยู่! โปรดเลือกเครื่องอื่น` });
        }

        const requestData = { workerId: socket.id, bankName: data.bankName, accNo: data.accNo, system: system };

        if (host.isBusy) {
            host.queue.push(requestData);
            socket.emit('queue_status', { position: host.queue.length });
            broadcastLiveStatus();
        } else {
            host.isBusy = true;
            socket.emit('queue_status', { position: 0 });
            io.to(host.socketId).emit('do_check', requestData);
            broadcastLiveStatus();
        }
    });

    // 🌟 เมื่อบอททำเสร็จและส่งผลลัพธ์กลับมา
    socket.on('send_result', (data) => {
        if (!data) return;
        const system = data.system;
        const host = hosts[system];
        
        if (data.workerId) io.to(data.workerId).emit('check_result', data.result);

        if (host && host.queue.length > 0) {
            const nextRequest = host.queue.shift();
            host.queue.forEach((req, index) => { io.to(req.workerId).emit('queue_status', { position: index + 1 }); });
            io.to(nextRequest.workerId).emit('queue_status', { position: 0 });
            io.to(host.socketId).emit('do_check', nextRequest);
        } else if (host) {
            host.isBusy = false;
        }
        broadcastLiveStatus();
    });

    // 🌟 เมื่อบอทหรือลูกน้องปิดหน้าต่างไป
    socket.on('disconnect', () => {
        for (let hostId in hosts) {
            if (hosts[hostId].socketId === socket.id) {
                hosts[hostId].socketId = null;
                hosts[hostId].isBusy = false;
                console.log(`🔴 บอส [${hostId}] ออฟไลน์หนีไปแล้ว!`);
                broadcastLiveStatus();
            } else {
                // ล้างคิวงานของลูกน้องคนที่ปิดเว็บหนี
                const initialLen = hosts[hostId].queue.length;
                hosts[hostId].queue = hosts[hostId].queue.filter(req => req.workerId !== socket.id);
                if (hosts[hostId].queue.length !== initialLen) broadcastLiveStatus();
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
