const { isUserOption } = require('../../utils/common');
const generateDynamicFlowData = require('./conversationFlowGenerator');

const extractMandatoryFieldsFromFlow = (flowTrainingData) => {
    const fieldSet = new Set();
    const optionObjects = [];

    flowTrainingData?.nodes?.forEach((node) => {
        node?.data?.inputs?.forEach((input) => {
            if (input?.field === 'replay') {
                const matches = input?.value?.match(/\[([^\]]+)\]/g) || [];
                matches.forEach((match) => {
                    const fieldName = match.replace(/[\[\]]/g, '').trim();
                    if (fieldName) fieldSet.add(fieldName);
                });
            } else if (input?.field === 'preference') {
                input?.options?.forEach((opt, i) => {
                    if (i > 0 && opt?.id && opt?.value) {
                        optionObjects.push({
                            id: String(opt.id).trim(),
                            value: String(opt.value).trim()
                        });
                    }
                });
            }
        });
    });

    const result = Array.from(fieldSet);
    if (optionObjects.length > 0) {
        result.push({
            field: 'preference',
            preferenceOptions: optionObjects
        });
    }

    return result;
};

const generateDynamicPrompt = async (
    conversationHistory = [],
    ConsultantMessage = '',
    flowTrainingData = {},
    currentNodeId,
) => {
    if (!flowTrainingData) return null;
    const isUserOptions = isUserOption(ConsultantMessage, 'P-SL');
    const selectedSlots = Array.isArray(ConsultantMessage)
        ? ConsultantMessage.filter(Boolean) 
        : ConsultantMessage
            ? [ConsultantMessage]
            : [];
    const normalizedMessage = selectedSlots.join(', ');

    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toLocaleTimeString();
    const currentYear = now.getFullYear();
console.log(conversationHistory);
    const structuredFlow = await generateDynamicFlowData(flowTrainingData, ConsultantMessage);
    const currentStep = structuredFlow?.find(step => step?.nodeId === currentNodeId);

    if (!currentStep) {
        return `⚠️ Error: Flow step with nodeId "${currentNodeId}" not found.`;
    }

    const mandatoryFields = extractMandatoryFieldsFromFlow(flowTrainingData);

    const flowData = structuredFlow
        ?.map(section => {
            const instructions = section?.instructions?.map(i => `  - ${i}`).join('\n') || '';
            return `- ${section?.section || 'Unknown'} (Node ID: ${section?.nodeId || 'N/A'}):\n${instructions}`;
        })
        .join('\n');

    const prompt = `
        **Training Data**
        Key Flow Instructions:
        ${flowData}

        **Conversation History**
        ${conversationHistory.filter(Boolean).join('\n')}

        **New Consultant Message**
        ${ConsultantMessage || '[Empty]'}

        **Consultant selected Time Slots**
        ${isUserOptions ? normalizedMessage : 'N/A'}

        **System Time**
        ${currentDate} (${currentYear}) - ${currentTime}

        📌 **Instruction: Collect Required Fields and Prepare Structured Response**
        🎯 **Required Fields to Collect**
        ${mandatoryFields.length > 0
            ? mandatoryFields.map(field => `- ${field.field || field}`).join('\n')
            : '✅ No mandatory fields required.'
        }
        
    `.trim();
    return prompt;
};

module.exports = generateDynamicPrompt;


















  

















  
