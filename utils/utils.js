
//fetch single value from DB
const getOnlyOne = async (param, model) => {
    try {
        const query = { [param]: { $exists: true } };
        const data = await model.find(query, { [param]: 1, _id: 0 });
        return data;
    } catch (err) {
        console.error(`Error fetching ${param} values:`, err);
        return [];
    }
};

module.exports = getOnlyOne;