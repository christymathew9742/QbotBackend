const fs = require('fs');
const SpeechSDK = require('microsoft-cognitiveservices-speech-sdk');
const {azureKey, azureRegion} = require('../../config/whatsappConfig')

const processAudioWithAzureSTT =  (audioStream)  => {
    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(azureKey, azureRegion);
    // speechConfig.speechRecognitionLanguage = "en-IN"; 
    const pushStream = SpeechSDK.AudioInputStream.createPushStream();

    audioStream.on('data', (chunk) => pushStream.write(chunk));
    audioStream.on('end', () => pushStream.close());

    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);

     const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
     recognizer.recognizeOnceAsync((result) => {
         if (result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
             console.log("Recognized Speech hhhhhh:", result.text);
         } else {
             console.error("Speech Recognition Error:", result.errorDetails);
         }
     });
}

const playTextToSpeech = (text, outputFilePath = "output.wav") => {
    // Initialize speech configuration
    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(azureKey, azureRegion);
    speechConfig.speechSynthesisVoiceName = "en-US-AriaNeural"; // Neural voice for better quality

    // Create a file output stream
    const audioConfig = SpeechSDK.AudioConfig.fromAudioFileOutput(outputFilePath);

    // Create a speech synthesizer
    const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);

    // Start synthesizing text
    synthesizer.speakTextAsync(
        text,
        (result) => {
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                console.log(`TTS Audio Synthesis Completed. File saved to: ${outputFilePath}`);
            } else {
                console.error("TTS Error:", result.errorDetails);
            }
            synthesizer.close(); // Clean up
        },
        (err) => {
            console.error("Error during TTS synthesis:", err);
            synthesizer.close(); // Clean up
        }
    );
};




module.exports = {processAudioWithAzureSTT,playTextToSpeech}





















// recognizer.recognizeOnceAsync((result) => {
//     if (result.reason === sdk.ResultReason.RecognizedSpeech) {
//         callback(null, result.text);
//     } else {
//         callback(result.errorDetails || "Speech Recognition Failed", null); 
//     }
// });