const User = require('../../models/User');
const puppeteer = require('puppeteer');
const axios = require('axios');
const FormData = require('form-data');
const { baseUrl } = require('../../config/whatsappConfig');
let browserInstance = null;

const getBrowser = async () => {
    if (browserInstance && !browserInstance.isConnected()) {
        console.warn("⚠️ Browser was disconnected. Resetting instance.");
        browserInstance = null;
    }

    if (!browserInstance) {
        console.log("🚀 Launching new browser instance...");
        try {
            browserInstance = await puppeteer.launch({ 
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--font-render-hinting=none'
                ],
                headless: 'new' 
            });

            browserInstance.on('disconnected', () => {
                console.log("❌ Browser disconnected.");
                browserInstance = null;
            });

        } catch (err) {
            console.error("🔥 Failed to launch browser:", err);
            throw err;
        }
    }
    return browserInstance;
};

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
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                timeZone: timezone
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

        if (dateStr && timeStr) return `${dateStr} • ${timeStr}`;
        if (dateStr) return dateStr;
        return rawString;

    } catch (e) {
        return rawString;
    }
};

const uploadAndSendPDF = async (userPhone, botUser, pdfBuffer, fileName) => {
    try {
        const form = new FormData();
        const safeBuffer = Buffer.from(pdfBuffer);

        form.append("messaging_product", "whatsapp");
        form.append("file", safeBuffer, {
            filename: fileName,
            contentType: 'application/pdf',
        });

        const upHeaders = {
            Authorization: `Bearer ${botUser.accesstoken}`,
            ...form.getHeaders()
        };

        const upResp = await axios.post(
            `${baseUrl}/${botUser.phonenumberid}/media`,
            form,
            {
                headers: upHeaders,
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            }
        );

        const mediaId = upResp.data.id;

        await axios.post(
            `${baseUrl}/${botUser.phonenumberid}/messages`,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: userPhone,
                type: "document",
                document: {
                    id: mediaId,
                    caption: "✅ Appointment Confirmed",
                    filename: fileName
                }
            },
            {
                headers: { Authorization: `Bearer ${botUser.accesstoken}` }
            }
        );

        return true;
    } catch (e) {
        console.error(`❌ Direct PDF Send Failed [${userPhone}]:`, e.response?.data || e.message);
        return false;
    }
};

const generateBookingHTML = (details) => {
    const { 
        refId, 
        date, 
        department, 
        slotTime, 
        extraData, 
        businessProfile, 
        timezone, 
        language 
    } = details;
    
    const formattedSlot = formatSlotDisplay(slotTime, timezone, language);
    const primaryColor = "#493e81";
    const lightText = "#6b7280";
    const darkText = "#1f2937";

    const formatValueOrFileCount = (val) => {
        if (typeof val !== 'string') return val;

        const types = {
            'Image': ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'tiff'],
            'Video': ['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'flv'],
            'Audio': ['mp3', 'wav', 'aac', 'ogg', 'm4a', 'amr'],
            'Document': ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv']
        };

        const items = val.split(',');
        let counts = { 'Image': 0, 'Video': 0, 'Audio': 0, 'Document': 0 };
        let isFile = false;

        items.forEach(item => {
            const trimmed = item.trim();
            if (trimmed.includes('.')) {
                const ext = trimmed.split('.').pop().toLowerCase();
                
                let foundType = false;
                if (types.Image.includes(ext)) { counts.Image++; foundType = true; }
                else if (types.Video.includes(ext)) { counts.Video++; foundType = true; }
                else if (types.Audio.includes(ext)) { counts.Audio++; foundType = true; }
                else if (types.Document.includes(ext)) { counts.Document++; foundType = true; }
                
                if (foundType) isFile = true;
            }
        });

        if (!isFile) return val;

        const summary = Object.entries(counts)
            .filter(([_, count]) => count > 0)
            .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
            .join(', ');

        return summary;
    };

    const extraNotesHtml = Object.entries(extraData)
        .filter(([key, value]) => key !== 'preference' && typeof value !== 'object')
        .map(([key, value]) => {
            const displayValue = formatValueOrFileCount(value);
            return `
            <div class="detail-item">
                <div class="label">${key.replace(/_/g, ' ')}</div>
                <div class="value">${displayValue}</div>
            </div>
        `})
        .join('');

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
                @page { margin: 0; size: auto; }
                *, *::before, *::after { box-sizing: border-box; }
                html, body { margin: 0; padding: 0; overflow: hidden; height: auto; background-color: white; }
                body { font-family: 'Inter', sans-serif; color: ${darkText}; -webkit-print-color-adjust: exact; }
                
                .page-container { 
                    width: 100%; 
                    background: white; 
                    position: relative; 
                    overflow: hidden;
                    display: block;
                    padding-bottom: 2px;
                }
                
                .header { background-color: ${primaryColor}; color: white; padding: 40px 50px; display: flex; justify-content: space-between; align-items: flex-start; }
                .brand h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
                .brand p { margin: 5px 0 0; font-size: 14px; opacity: 0.9; font-weight: 400; }
                .status-box { display: flex; flex-direction: column; align-items: flex-end; }
                .status-badge { background: rgba(255, 255, 255, 0.2); padding: 8px 16px; border-radius: 20px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(255,255,255,0.3); }
                .status-badge svg { width: 16px; height: 16px; fill: #16a34a; } 
                .ref-id { font-size: 14px; opacity: 0.9; margin-top: 8px; }
                .content { padding: 40px 50px 0px 50px; }
                .section-title { display: flex; align-items: center; font-size: 15px; font-weight: 700; color: ${primaryColor}; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; margin-bottom: 25px; margin-top: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
                .section-title svg { width: 20px; height: 20px; margin-right: 10px; fill: ${primaryColor}; }
                .primary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 40px; }
                .card { background: #f9fafb; border-left: 5px solid ${primaryColor}; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
                .card-label { font-size: 12px; color: ${lightText}; text-transform: uppercase; font-weight: 600; margin-bottom: 8px; }
                .card-value { font-size: 18px; font-weight: 700; color: ${primaryColor}; }
                .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; }
                .detail-item { margin-bottom: 5px; }
                .label { font-size: 12px; color: ${lightText}; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; }
                .value { font-size: 15px; font-weight: 500; color: ${darkText}; text-transform: capitalize; border-bottom: 1px solid #f0f0f0; padding-bottom: 5px; width: 90%; }
                .footer { width: 100%; background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 0; text-align: center; margin-top: 40px; }
                .footer-text { font-size: 11px; color: ${lightText}; margin: 3px 0; }
            </style>
        </head>
        <body>
            <div class="page-container" id="main-container">
                <div class="header">
                    <div class="brand">
                        <h1>${businessProfile}</h1>
                        <p>Confirmed Booking Receipt</p>
                    </div>
                    <div class="status-box">
                        <div class="status-badge">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"> 
                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/> 
                            </svg>
                            Confirmed
                        </div>
                        <div class="ref-id">Ref ID: ${refId}</div>
                    </div>
                </div>
                <div class="content">
                    <div class="section-title">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19,4H18V2H16V4H8V2H6V4H5A2,2 0 0,0 3,6V20A2,2 0 0,0 5,22H19A2,2 0 0,0 21,20V6A2,2 0 0,0 19,4M19,20H5V10H19V20M19,8H5V6H19V8M9,14H7V12H9V14M13,14H11V12H13V14M17,14H15V12H17V14M9,18H7V16H9V18M13,18H11V16H13V18M17,18H15V16H17V18Z"/></svg>
                        Appointment Overview
                    </div>
                    <div class="primary-grid">
                        <div class="card">
                            <div class="card-label">Department / Service</div>
                            <div class="card-value">${department}</div>
                        </div>
                        <div class="card">
                            <div class="card-label">Date & Time Slot</div>
                            <div class="card-value">${formattedSlot}</div>
                        </div>
                    </div>
                    <div class="section-title">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/></svg>
                        Applicant Details
                    </div>
                    <div class="details-grid">
                        <div class="detail-item">
                            <div class="label">Date Generated</div>
                            <div class="value">${date}</div>
                        </div>
                        ${extraNotesHtml}
                    </div>
                    
                    <div style="margin-top: 25px; padding: 20px; background: #fffbe6; border: 1px solid #ffe58f; border-radius: 6px;">
                        <div style="font-size: 12px; font-weight: bold; color: #d48806; margin-bottom: 5px;">⚠️ Important Note</div>
                        <div style="font-size: 13px; color: #555;">
                            Please arrive at least 15 minutes before your scheduled time. Present this digital slip or the reference number at the counter.
                        </div>
                    </div>
                </div>
                <div class="footer">
                    <div class="footer-text">This is a computer-generated document. No signature is required.</div>
                    <div class="footer-text">© ${new Date().getFullYear()} NimpleMeet</div>
                </div>
            </div>
        </body>
        </html>
    `;
};

const generateAndSendBookingSlip = async (userPhone, bookingDetails) => {
    let page = null;
    try {
        console.log(`Generating Booking Slip for ${userPhone}...`);
        
        const botUser = await User.findById(bookingDetails.userId);
        if (!botUser || !botUser.accesstoken) {
            console.error("❌ Cannot send PDF: Bot user not found or missing token.");
            return false;
        }

        const targetTz = bookingDetails?.timezone || 'UTC';
        const targetLang = bookingDetails?.language || 'en-US';
        const dateGenerated = new Intl.DateTimeFormat(targetLang, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: targetTz
        }).format(new Date());

        const htmlContent = generateBookingHTML({
            refId: bookingDetails?.refId,
            date: dateGenerated, 
            department: bookingDetails?.flowTitle, 
            slotTime: bookingDetails?.slot,
            extraData: bookingDetails?.data || {},
            businessProfile: bookingDetails?.businessProfile,
            language: targetLang,
            timezone: targetTz,
        });

        const browser = await getBrowser();
        page = await browser.newPage();
        
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        const contentHeight = await page.evaluate(() => {
            const container = document.getElementById('main-container');
            return container ? container.offsetHeight : document.body.scrollHeight;
        });

        const pdfBuffer = await page.pdf({ 
            width: '210mm',
            height: `${contentHeight}px`,
            printBackground: true,
            pageRanges: '1',
            margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
        });

        const fileName = `Appointment_${Date.now()}.pdf`;

        await uploadAndSendPDF(userPhone, botUser, pdfBuffer, fileName);
        return true;

    } catch (error) {
        console.error("❌ Error generating/sending booking slip:", error.message);
        return false;
    } finally {
        if (page) {
            try { await page.close(); } catch(e) { }
        }
    }
};

module.exports = { generateAndSendBookingSlip };