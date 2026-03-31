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

// 🌟 ฟังก์ชันใหม่: กระจายข่าวบอกพนักงานทุกคนว่าคิวว่างหรือติดคิวกี่คนแบบ Real-time
function broadcastLiveStatus() {
    io.emit('live_queue_status', { 
        count: queue.length, 
        isProcessing: isHostBusy 
    });
}

io.on('connection', (socket) => {
    // 🌟 พอพนักงานเปิดส่วนขยายปุ๊บ ส่งบอกทันทีว่าคิวเท่าไหร่
    socket.emit('live_queue_status', { count: queue.length, isProcessing: isHostBusy });

    socket.on('register', (role) => {
        if (role === 'host') {
            hostSocketId = socket.id;
            isHostBusy = false;
            queue = [];
            broadcastLiveStatus(); // แจ้งทุกคนว่าบอสพร้อมรับงานแล้ว
        }
    });

    // เมื่อพนักงานส่งคำสั่ง
    socket.on('request_check', (data) => {
        if (!hostSocketId) {
            return socket.emit('check_result', { status: 'error', message: '❌ บอส (Host) ออฟไลน์' });
        }

        const requestData = { workerId: socket.id, bankName: data.bankName, accNo: data.accNo, system: data.system };

        if (isHostBusy) {
            // ถ้าบอสไม่ว่าง จับเข้าคิว
            queue.push(requestData);
            socket.emit('queue_status', { position: queue.length }); // แจ้งพนักงานว่าติดคิวที่เท่าไหร่
            broadcastLiveStatus(); // 🌟 อัปเดตตัวเลขคิวสีแดงให้ทุกคนเห็น
        } else {
            // ถ้าบอสว่าง โยนงานให้เลย
            isHostBusy = true;
            socket.emit('queue_status', { position: 0 }); // 0 = ไม่ติดคิว กำลังดึงข้อมูล
            io.to(hostSocketId).emit('do_check', requestData);
            broadcastLiveStatus(); // 🌟 อัปเดตว่าตอนนี้บอสกำลังทำงาน (ไม่ว่างแล้ว)
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
        
        broadcastLiveStatus(); // 🌟 อัปเดตสถานะคิวล่าสุดหลังจบงาน (หรือป้ายกลับเป็นสีเขียวถ้าคิวว่าง)
    });

    socket.on('disconnect', () => {
        if (socket.id === hostSocketId) {
            hostSocketId = null;
            isHostBusy = false;
            queue = [];
            broadcastLiveStatus(); // 🌟 บอสหลุด รีเซ็ตคิวทั้งหมด
        } else {
            // ถ้าพนักงานออกไปก่อน คัดออกจากคิว
            const initialLength = queue.length;
            queue = queue.filter(req => req.workerId !== socket.id);
            if (queue.length !== initialLength) {
                broadcastLiveStatus(); // 🌟 อัปเดตตัวเลขคิวถ้ามีคนกดยกเลิก/ปิดหน้าต่างไปก่อน
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
