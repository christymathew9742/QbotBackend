const { isUserOption } = require('../../utils/common');
const generateDynamicFlowData = require('./conversationFlowGenerator');

const extractMandatoryFieldsFromFlow = (flowTrainingData = {}) => {
    const fieldSet = new Set();
    const optionObjects = [];

    flowTrainingData?.nodes?.forEach(node => {
        node?.data?.inputs?.forEach(input => {
            if (input?.field === 'replay') {
                (input?.value?.match(/\[([^\]]+)\]/g) || [])
                .forEach(match => {
                    const fieldName = match.slice(1, -1).trim();
                    if (fieldName) fieldSet.add(fieldName);
                });
            } else if (input?.field === 'preference') {
                input?.options?.slice(1).forEach(opt => {
                    if (opt?.id && opt?.value) {
                        optionObjects.push({ id: String(opt.id).trim(), value: String(opt.value).trim() });
                    }
                });
            }
        });
    });

    const result = [...fieldSet];
    if (optionObjects.length) result.push({ field: 'preference', preferenceOptions: optionObjects });
    return result;
};

const generateDynamicPrompt = async (
    conversationHistory = [],
    ConsultantMessage = '',
    flowTrainingData = {},
    currentNodeId
) => {
    if (!flowTrainingData?.nodes) return null;

    const isUserOptions = isUserOption(ConsultantMessage, 'P-SL');
    const selectedSlots = Array.isArray(ConsultantMessage)
        ? ConsultantMessage.filter(Boolean)
        : ConsultantMessage
        ? [ConsultantMessage]
        : [];
    const normalizedMessage = selectedSlots.join(', ');

    const now = new Date();
    const structuredFlow = await generateDynamicFlowData(flowTrainingData, ConsultantMessage);
    const currentStep = structuredFlow?.find(step => step?.nodeId === currentNodeId);
    if (!currentStep) return `⚠️ Error: Flow step with nodeId "${currentNodeId}" not found.`;

    const mandatoryFields = extractMandatoryFieldsFromFlow(flowTrainingData);
    const flowData = structuredFlow
        ?.map(section => `- ${section?.section || 'Unknown'} (Node ID: ${section?.nodeId || 'N/A'}):\n${(section?.instructions || []).map(i => `  - ${i}`).join('\n')}`)
        .join('\n');

    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toLocaleTimeString();
    const currentYear = now.getFullYear();

    return `
        **Training Data**
        Key Flow Instructions:
        ${flowData}

        **Conversation History**
        ${conversationHistory.filter(Boolean).join('\n')}

        **New Consultant Message**
        ${ConsultantMessage || '[Empty]'}

        **Consultant Selected Time Slots**
        ${isUserOptions ? normalizedMessage : 'N/A'}

        **System Time**
        ${currentDate} (${currentYear}) - ${currentTime}

        📌 **Instruction: Collect Required Fields and Prepare Structured Response**
        🎯 **Required Fields to Collect**
        ${mandatoryFields.length ? mandatoryFields.map(f => `- ${f.field || f}`).join('\n') : '✅ No mandatory fields required.'}
    `.trim();
};

module.exports = generateDynamicPrompt;

