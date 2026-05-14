const common = require('@screeps/common');

console.log('Example Mod loaded!');

module.exports = function(config) {
    console.log('Mod initialized!');
    if (config.common && config.common.constants) {
        const keys = Object.keys(config.common.constants);
        console.log('Screeps Constants (from config):', keys.slice(0, 5), '...');
    } else {
        console.log('Screeps Constants not found in config.common');
    }
    console.log('Mod initialized with config keys:', Object.keys(config));
};
