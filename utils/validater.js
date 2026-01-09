const emojiRegex = require('emoji-regex');
const validator = require('validator');
const Filter = require('bad-words');
const filter = new Filter();


const clean = (text = '') =>
    text.trim();

const isAbusive = (text) => {
    const t = clean(text);
    if (filter.isProfane(t)) return true;
};

const isEmojiOnly = (text = '') => {
    const t = text.trim();
    if (!t) return false;
    const regex = emojiRegex();
    const emojis = t.match(regex);
    return emojis && emojis.join('') === t;
};

// const isValidOptions = (val) => {
//   return typeof val === 'string'
//     ? /^[1-9]\d{12}$/.test(val)
//     : Number.isInteger(val) && /^[1-9]\d{12}$/.test(String(val));
// };

module.exports = {
    isAbusive,
    isEmojiOnly,
    // isValidOptions,
};
