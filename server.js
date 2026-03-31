const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 🌟 แยกสมองเก็บข้อมูลเครื่อง 1 และ เครื่อง 2
const hosts = {
    'kbiz_1': { socketId: null, isBusy: false, queue: [] },
    'kbiz_2': { socketId: null, isBusy: false, queue: [] }
};

// ฟังก์ชันกระจายข่าวบอกพนักงานว่าแต่ละเครื่องสถานะเป็นยังไง
function broadcastLiveStatus() {
    io.emit('live_queue_status', {
        kbiz_1: { count: hosts['kbiz_1'].queue.length, isProcessing: hosts['kbiz_1'].isBusy, isOnline: !!hosts['kbiz_1'].socketId },
        kbiz_2: { count: hosts['kbiz_2'].queue.length, isProcessing: hosts['kbiz_2'].isBusy, isOnline: !!hosts['kbiz_2'].socketId }
    });
}

io.on('connection', (socket) => {
    broadcastLiveStatus(); // เปิดปุ๊บ แจ้งสถานะปั๊บ

    // 🌟 รับลงทะเบียนบอส ระบุตัวตนว่าเป็นเครื่องไหน
    socket.on('register', (data) => {
        if (data.role === 'host') {
            const hostId = data.hostId; // 'kbiz_1' หรือ 'kbiz_2'
            if (hosts[hostId]) {
                hosts[hostId].socketId = socket.id;
                hosts[hostId].isBusy = false;
                hosts[hostId].queue = [];
                console.log(`🟢 บอส [${hostId}] ออนไลน์พร้อมรับงาน`);
                broadcastLiveStatus();
            }
        }
    });

    // เมื่อพนักงานส่งคำสั่งค้นหา
    socket.on('request_check', (data) => {
        const system = data.system; // 'kbiz_1' หรือ 'kbiz_2'
        const host = hosts[system];

        if (!host || !host.socketId) {
            return socket.emit('check_result', { status: 'error', message: `❌ เครื่อง ${system === 'kbiz_1' ? '1' : '2'} ออฟไลน์อยู่!` });
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

    // เมื่อบอสทำงานเสร็จ
    socket.on('send_result', (data) => {
        const system = data.system;
        const host = hosts[system];
        
        io.to(data.workerId).emit('check_result', data.result);

        if (host && host.queue.length > 0) {
            const nextRequest = host.queue.shift();
            host.queue.forEach((req, index) => {
                io.to(req.workerId).emit('queue_status', { position: index + 1 });
            });
            io.to(nextRequest.workerId).emit('queue_status', { position: 0 });
            io.to(host.socketId).emit('do_check', nextRequest);
        } else if (host) {
            host.isBusy = false;
        }
        broadcastLiveStatus();
    });

    // เมื่อบอสหรือพนักงานปิดหน้าต่าง
    socket.on('disconnect', () => {
        for (let hostId in hosts) {
            if (hosts[hostId].socketId === socket.id) {
                hosts[hostId].socketId = null;
                hosts[hostId].isBusy = false;
                hosts[hostId].queue = [];
                console.log(`🔴 บอส [${hostId}] ออฟไลน์`);
                broadcastLiveStatus();
            } else {
                // เคลียร์คิวของพนักงานที่ปิดหน้าต่างหนี
                const initialLen = hosts[hostId].queue.length;
                hosts[hostId].queue = hosts[hostId].queue.filter(req => req.workerId !== socket.id);
                if (hosts[hostId].queue.length !== initialLen) broadcastLiveStatus();
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
