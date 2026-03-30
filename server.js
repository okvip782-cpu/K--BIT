const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let hostSocketId = null;
let isHostBusy = false; // ตัวเช็คว่าบอสทำงานอยู่ไหม
let queue = []; // แถวเข้าคิว

io.on('connection', (socket) => {
    socket.on('register', (role) => {
        if (role === 'host') {
            hostSocketId = socket.id;
            isHostBusy = false;
            queue = [];
        }
    });

    // เมื่อพนักงานส่งคำสั่ง
    socket.on('request_check', (data) => {
        if (!hostSocketId) {
            return socket.emit('check_result', { status: 'error', message: '❌ บอส (Host) ออฟไลน์' });
        }

        const requestData = { workerId: socket.id, bankName: data.bankName, accNo: data.accNo };

        if (isHostBusy) {
            // ถ้าบอสไม่ว่าง จับเข้าคิว
            queue.push(requestData);
            socket.emit('queue_status', { position: queue.length }); // แจ้งพนักงานว่าติดคิวที่เท่าไหร่
        } else {
            // ถ้าบอสว่าง โยนงานให้เลย
            isHostBusy = true;
            socket.emit('queue_status', { position: 0 }); // 0 = ไม่ติดคิว กำลังดึงข้อมูล
            io.to(hostSocketId).emit('do_check', requestData);
        }
    });

    // เมื่อบอสทำงานเสร็จ ส่งชื่อกลับมา
    socket.on('send_result', (data) => {
        io.to(data.workerId).emit('check_result', data.result);

        // เช็คว่ามีคิวรออยู่ไหม
        if (queue.length > 0) {
            const nextRequest = queue.shift(); // ดึงคิวแรกสุดออกมา
            // อัปเดตเลขคิวให้คนที่เหลือ
            queue.forEach((req, index) => {
                io.to(req.workerId).emit('queue_status', { position: index + 1 });
            });
            // สั่งบอสทำงานคิวต่อไปทันที
            io.to(nextRequest.workerId).emit('queue_status', { position: 0 });
            io.to(hostSocketId).emit('do_check', nextRequest);
        } else {
            isHostBusy = false; // บอสว่างแล้ว
        }
    });

    socket.on('disconnect', () => {
        if (socket.id === hostSocketId) {
            hostSocketId = null;
            isHostBusy = false;
            queue = [];
        } else {
            // ถ้าพนักงานออกไปก่อน คัดออกจากคิว
            queue = queue.filter(req => req.workerId !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
