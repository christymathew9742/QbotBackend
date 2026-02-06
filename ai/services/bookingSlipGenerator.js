// const User = require('../../models/User');
// const axios = require('axios');
// const FormData = require('form-data');
// const PDFDocument = require('pdfkit-table');
// const { baseUrl } = require('../../config/whatsappConfig');

// // ==========================================
// // Helper: Data Formatting
// // ==========================================
// const formatSlotDisplay = (rawString, timezone = 'UTC', language = 'en-US') => {
//     try {
//         if (!rawString) return "Not Scheduled";
//         const parts = rawString.toString().trim().split(' ');
//         const timestampStr = parts.find(p => p.length > 10 && !isNaN(p));
//         const times = parts.filter(p => p.includes(':'));
        
//         let dateStr = "";
//         let timeStr = "";
        
//         if (timestampStr) {
//             const date = new Date(parseInt(timestampStr));
//             dateStr = new Intl.DateTimeFormat(language, {
//                 weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone
//             }).format(date);
//         }
        
//         if (times.length > 0) {
//             const formattedTimes = times.map(t => {
//                 const [h, m] = t.split(':');
//                 const hour = parseInt(h);
//                 const suffix = hour >= 12 ? 'PM' : 'AM';
//                 const displayHour = hour % 12 || 12;
//                 return `${displayHour}:${m} ${suffix}`;
//             });
//             timeStr = formattedTimes.join(' - ');
//         }
        
//         return (dateStr && timeStr) ? `${dateStr} • ${timeStr}` : (dateStr || rawString);
//     } catch (e) { return rawString; }
// };

// const formatValueOrFileCount = (val) => {
//     if (typeof val !== 'string') return val;
//     const types = { 'Image': ['jpg','png','jpeg'], 'Video': ['mp4'], 'Audio': ['mp3'], 'Doc': ['pdf','doc'] };
//     const items = val.split(',');
//     let counts = {};
//     let isFile = false;

//     items.forEach(item => {
//         const ext = item.trim().split('.').pop().toLowerCase();
//         for (const [key, extensions] of Object.entries(types)) {
//             if (extensions.some(e => ext.includes(e))) {
//                 counts[key] = (counts[key] || 0) + 1;
//                 isFile = true;
//             }
//         }
//     });

//     if (!isFile) return val;
//     return Object.entries(counts).map(([k,v]) => `${v} ${k}`).join(', ');
// };

// // ==========================================
// // Helper: WhatsApp Upload
// // ==========================================
// const uploadAndSendPDF = async (userPhone, botUser, pdfBuffer, fileName) => {
//     try {
//         const form = new FormData();
//         form.append("messaging_product", "whatsapp");
//         form.append("file", pdfBuffer, { filename: fileName, contentType: 'application/pdf' });

//         const upResp = await axios.post(
//             `${baseUrl}/${botUser.phonenumberid}/media`,
//             form,
//             { headers: { Authorization: `Bearer ${botUser.accesstoken}`, ...form.getHeaders() } }
//         );

//         await axios.post(
//             `${baseUrl}/${botUser.phonenumberid}/messages`,
//             {
//                 messaging_product: "whatsapp",
//                 recipient_type: "individual",
//                 to: userPhone,
//                 type: "document",
//                 document: { id: upResp.data.id, caption: "✅ Appointment Confirmed", filename: fileName }
//             },
//             { headers: { Authorization: `Bearer ${botUser.accesstoken}` } }
//         );
//         return true;
//     } catch (e) {
//         console.error(`❌ Send Failed:`, e.message);
//         return false;
//     }
// };

// // ==========================================
// // MAIN: Low-Memory PDF Generation (PDFKit)
// // ==========================================
// const generateAndSendBookingSlip = async (userPhone, bookingDetails) => {
//     return new Promise(async (resolve) => {
//         try {
//             console.log(`⚡ Generating PDF (Low Memory) for ${userPhone}...`);
            
//             const botUser = await User.findById(bookingDetails.userId);
//             if (!botUser || !botUser.accesstoken) return resolve(false);

//             // 1. Create Document (No Browser!)
//             const doc = new PDFDocument({ margin: 0, size: 'A4' });
//             let buffers = [];
//             doc.on('data', buffers.push.bind(buffers));
//             doc.on('end', async () => {
//                 const pdfData = Buffer.concat(buffers);
//                 await uploadAndSendPDF(userPhone, botUser, pdfData, `Appointment_${Date.now()}.pdf`);
//                 resolve(true);
//             });

//             // --- Colors & Styles ---
//             const primaryColor = "#493e81";
//             const lightText = "#6b7280";
//             const darkText = "#1f2937";
//             const pageWidth = 595.28; // A4 width in points

//             // --- HEADER SECTION ---
//             doc.rect(0, 0, pageWidth, 120).fill(primaryColor);
            
//             // Brand Title
//             doc.fillColor('white').fontSize(20).font('Helvetica-Bold')
//                .text(bookingDetails.businessProfile || "Booking", 50, 40);
            
//             // Subtitle
//             doc.fontSize(10).font('Helvetica')
//                .text("Confirmed Booking Receipt", 50, 65);

//             // Status Badge (Visual simulation using shapes)
//             doc.roundedRect(pageWidth - 150, 40, 100, 24, 12)
//                .strokeColor('white').lineWidth(1).stroke();
//             doc.fontSize(10).font('Helvetica-Bold')
//                .text("CONFIRMED", pageWidth - 128, 47);
            
//             // Ref ID
//             doc.fontSize(9).font('Helvetica').fillColor('#e0e0e0')
//                .text(`Ref ID: ${bookingDetails.refId || '-'}`, pageWidth - 150, 75, { width: 100, align: 'right' });

//             // --- CONTENT SECTION ---
//             let y = 150;

//             // 1. Appointment Overview
//             doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text("APPOINTMENT OVERVIEW", 50, y);
//             doc.moveTo(50, y + 15).lineTo(pageWidth - 50, y + 15).strokeColor('#e5e7eb').stroke();
//             y += 30;

//             // Cards (Department & Slot)
//             const drawCard = (label, value, x, y) => {
//                 doc.roundedRect(x, y, 230, 60, 5).fillColor('#f9fafb').fill();
//                 doc.rect(x, y, 5, 60).fillColor(primaryColor).fill(); // Left border
//                 doc.fillColor(lightText).fontSize(8).font('Helvetica-Bold').text(label.toUpperCase(), x + 15, y + 15);
//                 doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text(value, x + 15, y + 30, { width: 200 });
//             };

//             const slotTxt = formatSlotDisplay(bookingDetails.slot, bookingDetails.timezone, bookingDetails.language);
            
//             drawCard("Department / Service", bookingDetails.flowTitle || '-', 50, y);
//             drawCard("Date & Time Slot", slotTxt, 300, y);
//             y += 90;

//             // 2. Applicant Details
//             doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text("APPLICANT DETAILS", 50, y);
//             doc.moveTo(50, y + 15).lineTo(pageWidth - 50, y + 15).strokeColor('#e5e7eb').stroke();
//             y += 30;

//             // Details Grid
//             const targetTz = bookingDetails?.timezone || 'UTC';
//             const dateGen = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: targetTz }).format(new Date());

//             const details = [
//                 { label: "Date Generated", value: dateGen },
//                 ...Object.entries(bookingDetails.data || {})
//                     .filter(([k,v]) => k !== 'preference' && typeof v !== 'object')
//                     .map(([k,v]) => ({ label: k.replace(/_/g, ' '), value: formatValueOrFileCount(v) }))
//             ];

//             let xPos = 50;
//             details.forEach((item, index) => {
//                 if (index > 0 && index % 2 === 0) { y += 50; xPos = 50; } // New Row
//                 else if (index % 2 !== 0) { xPos = 300; } // Second Column

//                 doc.fillColor(lightText).fontSize(8).font('Helvetica-Bold').text(item.label.toUpperCase(), xPos, y);
//                 doc.fillColor(darkText).fontSize(11).font('Helvetica').text(item.value, xPos, y + 12, { width: 200 });
//                 doc.moveTo(xPos, y + 30).lineTo(xPos + 200, y + 30).strokeColor('#f0f0f0').lineWidth(0.5).stroke();
//             });

//             y += 60;

//             // Warning Box
//             doc.roundedRect(50, y, pageWidth - 100, 50, 4).fillColor('#fffbe6').fill();
//             doc.strokeColor('#ffe58f').lineWidth(1).roundedRect(50, y, pageWidth - 100, 50, 4).stroke();
//             doc.fillColor('#d48806').fontSize(10).font('Helvetica-Bold').text("⚠️ Important Note", 65, y + 12);
//             doc.fillColor('#555555').fontSize(9).font('Helvetica').text("Please arrive at least 15 minutes before your scheduled time. Present this digital slip at the counter.", 65, y + 28);

//             // Footer
//             doc.fillColor('#f8fafc').rect(0, 750, pageWidth, 100).fill(); // Bg
//             doc.moveTo(0, 750).lineTo(pageWidth, 750).strokeColor('#e2e8f0').stroke();
//             doc.fillColor(lightText).fontSize(8).text("This is a computer-generated document. No signature is required.", 0, 770, { align: 'center' });
//             doc.text(`© ${new Date().getFullYear()} NimpleMeet`, 0, 785, { align: 'center' });

//             doc.end(); // Finish PDF

//         } catch (error) {
//             console.error("❌ Error generating PDF:", error);
//             resolve(false);
//         }
//     });
// };

// module.exports = { generateAndSendBookingSlip };

const User = require('../../models/User');
const axios = require('axios');
const FormData = require('form-data');
const PDFDocument = require('pdfkit-table'); 
const { baseUrl } = require('../../config/whatsappConfig');

// ==========================================
// Helper: Data Formatting
// ==========================================
const formatSlotDisplay = (rawString, timezone = 'UTC', language = 'en-US') => {
    try {
        if (!rawString) return "Not Scheduled";
        const parts = rawString.toString().trim().split(' ');
        const timestampStr = parts.find(p => p.length > 10 && !isNaN(p));
        const times = parts.filter(p => p.includes(':'));
        
        let dateStr = "";
        let timeStr = "";
        
        if (timestampStr) {
            const date = new Date(parseInt(timestampStr));
            dateStr = new Intl.DateTimeFormat(language, {
                weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone
            }).format(date);
        }
        
        if (times.length > 0) {
            const formattedTimes = times.map(t => {
                const [h, m] = t.split(':');
                const hour = parseInt(h);
                const suffix = hour >= 12 ? 'PM' : 'AM';
                const displayHour = hour % 12 || 12;
                return `${displayHour}:${m} ${suffix}`;
            });
            timeStr = formattedTimes.join(' - ');
        }
        
        return (dateStr && timeStr) ? `${dateStr} • ${timeStr}` : (dateStr || rawString);
    } catch (e) { return rawString; }
};

const formatValueOrFileCount = (val) => {
    if (typeof val !== 'string') return val;
    const types = { 'Image': ['jpg','png','jpeg'], 'Video': ['mp4'], 'Audio': ['mp3'], 'Doc': ['pdf','doc'] };
    const items = val.split(',');
    let counts = {};
    let isFile = false;

    items.forEach(item => {
        const ext = item.trim().split('.').pop().toLowerCase();
        for (const [key, extensions] of Object.entries(types)) {
            if (extensions.some(e => ext.includes(e))) {
                counts[key] = (counts[key] || 0) + 1;
                isFile = true;
            }
        }
    });

    if (!isFile) return val;
    return Object.entries(counts).map(([k,v]) => `${v} ${k}`).join(', ');
};

// ==========================================
// Helper: Vector Icon Drawings
// ==========================================
const drawCheckIcon = (doc, x, y, size) => {
    doc.save();
    // Green Circle Background
    doc.circle(x + size / 2, y + size / 2, size / 2)
       .fillColor('#22c55e') // Success Green
       .fill();
    
    // White Checkmark
    doc.strokeColor('white').lineWidth(2).lineCap('round').lineJoin('round');
    doc.moveTo(x + size * 0.28, y + size * 0.5)
       .lineTo(x + size * 0.45, y + size * 0.68)
       .lineTo(x + size * 0.72, y + size * 0.32)
       .stroke();
    doc.restore();
};

const drawClipboardIcon = (doc, x, y) => {
    doc.save();
    doc.scale(0.8, 0.8, { origin: [x, y] });
    doc.translate(x, y);
    // Draw Clipboard Path
    doc.path('M19,4H18V2H16V4H8V2H6V4H5A2,2 0 0,0 3,6V20A2,2 0 0,0 5,22H19A2,2 0 0,0 21,20V6A2,2 0 0,0 19,4M19,20H5V10H19V20M19,8H5V6H19V8M9,14H7V12H9V14M13,14H11V12H13V14M17,14H15V12H17V14M9,18H7V16H9V18M13,18H11V16H13V18M17,18H15V16H17V18Z')
       .fillColor('#493e81')
       .fill();
    doc.restore();
};

const drawUserIcon = (doc, x, y) => {
    doc.save();
    doc.scale(0.8, 0.8, { origin: [x, y] });
    doc.translate(x, y);
    // Draw User Path
    doc.path('M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z')
       .fillColor('#493e81')
       .fill();
    doc.restore();
};

// ==========================================
// Helper: WhatsApp Upload
// ==========================================
const uploadAndSendPDF = async (userPhone, botUser, pdfBuffer, fileName) => {
    try {
        const form = new FormData();
        form.append("messaging_product", "whatsapp");
        form.append("file", pdfBuffer, { filename: fileName, contentType: 'application/pdf' });

        const upResp = await axios.post(
            `${baseUrl}/${botUser.phonenumberid}/media`,
            form,
            { headers: { Authorization: `Bearer ${botUser.accesstoken}`, ...form.getHeaders() } }
        );

        await axios.post(
            `${baseUrl}/${botUser.phonenumberid}/messages`,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: userPhone,
                type: "document",
                document: { id: upResp.data.id, caption: "✅ Appointment Confirmed", filename: fileName }
            },
            { headers: { Authorization: `Bearer ${botUser.accesstoken}` } }
        );
        return true;
    } catch (e) {
        console.error(`❌ Send Failed:`, e.message);
        return false;
    }
};

// ==========================================
// MAIN: Low-Memory PDF Generation (PDFKit)
// ==========================================
const generateAndSendBookingSlip = async (userPhone, bookingDetails) => {
    return new Promise(async (resolve) => {
        try {
            console.log(`⚡ Generating PDF (Low Memory) for ${userPhone}...`);
            
            const botUser = await User.findById(bookingDetails.userId);
            if (!botUser || !botUser.accesstoken) return resolve(false);

            // 1. Create Document
            const doc = new PDFDocument({ margin: 0, size: 'A4' });
            let buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                const pdfData = Buffer.concat(buffers);
                await uploadAndSendPDF(userPhone, botUser, pdfData, `Appointment_${Date.now()}.pdf`);
                resolve(true);
            });

            // --- Layout Constants ---
            const primaryColor = "#493e81";
            const lightText = "#6b7280";
            const darkText = "#1f2937";
            const pageWidth = 595.28;
            
            // --- HEADER ---
            doc.rect(0, 0, pageWidth, 120).fill(primaryColor);
            
            // Brand Info
            doc.fillColor('white').fontSize(22).font('Helvetica-Bold')
               .text(bookingDetails.businessProfile || "Medical Center", 50, 40);
            
            doc.fontSize(10).font('Helvetica').fillColor('#e0e7ff')
               .text("Confirmed Booking Receipt", 50, 68);

            // "Confirmed" Badge (Glassmorphism effect)
            const badgeWidth = 110;
            const badgeX = pageWidth - 50 - badgeWidth;
            
            // Badge Background
            doc.save();
            doc.roundedRect(badgeX, 40, badgeWidth, 32, 16)
               .fillColor('white')
               .fillOpacity(0.15)
               .fill();
            doc.restore();
            
            // Badge Border
            doc.roundedRect(badgeX, 40, badgeWidth, 32, 16)
               .strokeColor('white')
               .strokeOpacity(0.3)
               .lineWidth(1)
               .stroke();

            // Badge Icon & Text
            drawCheckIcon(doc, badgeX + 10, 48, 16); // Draw Green Tick
            doc.fontSize(10).font('Helvetica-Bold').fillColor('white')
               .text("CONFIRMED", badgeX + 32, 51);

            // Reference ID
            doc.fontSize(9).font('Helvetica').fillColor('#cbd5e1')
               .text(`Ref ID: ${bookingDetails.refId || '-'}`, badgeX, 82, { width: badgeWidth, align: 'right' });

            // --- CONTENT START ---
            let y = 160;

            // 1. APPOINTMENT OVERVIEW
            drawClipboardIcon(doc, 50, y - 5);
            doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold')
               .text("APPOINTMENT OVERVIEW", 78, y);
            
            doc.moveTo(50, y + 20).lineTo(pageWidth - 50, y + 20)
               .strokeColor('#e5e7eb').lineWidth(1).stroke();
            y += 35;

            // Cards Logic
            const drawCard = (label, value, x, y) => {
                // Card Shadow (Simulated with gray border/bg)
                doc.roundedRect(x, y, 235, 70, 8).fillColor('#f8fafc').fill();
                
                // Accent Line
                doc.rect(x, y, 4, 70).fillColor(primaryColor).fill();
                
                // Content
                doc.fillColor(lightText).fontSize(9).font('Helvetica-Bold')
                   .text(label.toUpperCase(), x + 15, y + 15);
                   
                doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold')
                   .text(value, x + 15, y + 32, { width: 210, ellipsis: true });
            };

            const slotTxt = formatSlotDisplay(bookingDetails.slot, bookingDetails.timezone, bookingDetails.language);
            
            drawCard("Department / Service", bookingDetails.flowTitle || 'General', 50, y);
            drawCard("Date & Time Slot", slotTxt, 310, y);
            y += 100;

            // 2. APPLICANT DETAILS
            drawUserIcon(doc, 50, y - 5);
            doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold')
               .text("APPLICANT DETAILS", 78, y);
            
            doc.moveTo(50, y + 20).lineTo(pageWidth - 50, y + 20)
               .strokeColor('#e5e7eb').lineWidth(1).stroke();
            y += 35;

            // Details Grid
            const targetTz = bookingDetails?.timezone || 'UTC';
            const dateGen = new Intl.DateTimeFormat('en-US', { 
                year: 'numeric', month: 'long', day: 'numeric', timeZone: targetTz 
            }).format(new Date());

            const details = [
                { label: "Date Generated", value: dateGen },
                ...Object.entries(bookingDetails.data || {})
                    .filter(([k,v]) => k !== 'preference' && typeof v !== 'object')
                    .map(([k,v]) => ({ label: k.replace(/_/g, ' '), value: formatValueOrFileCount(v) }))
            ];

            let colLeft = 50;
            let colRight = 310;
            let currentY = y;

            details.forEach((item, index) => {
                const xPos = (index % 2 === 0) ? colLeft : colRight;
                if (index % 2 === 0 && index !== 0) currentY += 50; // New row

                doc.fillColor(lightText).fontSize(8).font('Helvetica-Bold')
                   .text(item.label.toUpperCase(), xPos, currentY);
                
                doc.fillColor(darkText).fontSize(11).font('Helvetica')
                   .text(item.value, xPos, currentY + 14, { width: 220, ellipsis: true });
                
                doc.moveTo(xPos, currentY + 32).lineTo(xPos + 200, currentY + 32)
                   .strokeColor('#f1f5f9').lineWidth(1).stroke();
            });

            currentY += 60;

            // Warning Box
            const warnY = currentY;
            doc.roundedRect(50, warnY, pageWidth - 100, 55, 6)
               .fillColor('#fffbeb').fill(); // Amber-50
            
            doc.roundedRect(50, warnY, pageWidth - 100, 55, 6)
               .strokeColor('#fcd34d').lineWidth(1).stroke(); // Amber-300

            // Warning Icon (Small Triangle)
            doc.save();
            doc.translate(65, warnY + 18);
            doc.path('M1,19 L10,2 L19,19 H1 z').fillColor('#d97706').fill();
            doc.fillColor('white').fontSize(10).text('!', 9, 7);
            doc.restore();

            doc.fillColor('#b45309').fontSize(10).font('Helvetica-Bold')
               .text("Important Note", 90, warnY + 14);
            
            doc.fillColor('#4b5563').fontSize(9).font('Helvetica')
               .text("Please arrive at least 15 minutes before your scheduled time. Present this digital slip or the reference number at the counter.", 90, warnY + 30, { width: 400 });

            // --- FOOTER ---
            const footerY = 750;
            doc.rect(0, footerY, pageWidth, 100).fill('#f8fafc');
            doc.moveTo(0, footerY).lineTo(pageWidth, footerY).strokeColor('#e2e8f0').stroke();
            
            doc.fillColor('#94a3b8').fontSize(8).font('Helvetica')
               .text("This is a computer-generated document. No signature is required.", 0, footerY + 25, { align: 'center' });
            
            doc.fillColor('#cbd5e1').fontSize(8)
               .text(`© ${new Date().getFullYear()} NimpleMeet • Automated Booking System`, 0, footerY + 40, { align: 'center' });

            doc.end();

        } catch (error) {
            console.error("❌ Error generating PDF:", error);
            resolve(false);
        }
    });
};

module.exports = { generateAndSendBookingSlip };