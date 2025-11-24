// conectionLocal.js
const { Pool } = require('pg'); 

const pool = new Pool({
    port: process.env.PORT_DB,
    host: process.env.HOST_DB,
    user: process.env.USER_DB,
    password: process.env.PASSWORD_DB,
    database: process.env.NAME_DB,
}); 

module.exports = pool; 