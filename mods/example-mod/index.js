const common = require('@screeps/common');

console.log('Example Mod loaded!');
console.log('Screeps Constants (from workspace):', Object.keys(common.constants).slice(0, 5), '...');

module.exports = function(config) {
    console.log('Mod initialized with config keys:', Object.keys(config));
};
