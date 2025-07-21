require('dotenv').config();

module.exports = {
    apiToken: process.env.META_API_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    baseUrl: 'https://graph.facebook.com/v22.0',
    whatsappPhoneId: `${process.env.PHONE_NUMBER_ID}`,
    webToken:  process.env.WEBHOOK_TOKEN,
    azureKey: process.env.AZURE_SPEECH_KEY,
    azureRegion: process.env.AZURE_SPEECH_REGION, 
};
