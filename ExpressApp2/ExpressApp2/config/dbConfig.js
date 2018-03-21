
var dbConfig = {
    user: 'taihoinst',
    password: 'taiho9788!',
    server: 'taiholab.database.windows.net',
    database: 'chatMng',
    connectionTimeout : 30000,
    requestTimeout : 30000,
    options: {
        encrypt: true
    }
};

var autowayDbConfig = {
    user: 'taihoinst',
    password: 'taiho9788!',
    server: 'taiholab.database.windows.net',
    database: 'autoway_1',
    connectionTimeout : 30000,
    requestTimeout : 30000,
    options: {
        encrypt: true
    }
}

module.exports = { dbConfig, autowayDbConfig }


