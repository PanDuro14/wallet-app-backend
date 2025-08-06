const bcrypt = require('bcryptjs'); 
const dbConnection = require('./dbConection'); 
const dbLocal = require('./dbConectionLocal'); 

let pool; 
(async () => {
    try {
        await dbConnection.connect(); 
        console.log('Conexión con la db remota exitosa: Usuarios'); 
        pool = dbConnection; 
    } catch (errRemota){
        console.warn('Error con la db remota. Intentando conexión local... ', errRemota.message); 

    try {
        await dbLocal.connect(); 
        console.log('Conexión con la db local exitosa: Usuarios'); 
        pool = dbLocal; 
    } catch (errLocal){
        console.error('Error al conectar con la db local: ', errLocal.message); 
    }
    }
})(); 

// Login de usuario: con email y contraseña
const login = async (email, password) => {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT * FROM users WHERE email = $1'; 
        pool.query(sql, [email], async (error, results) => {
            if (error) return reject(error); 
            if (results.rows.length === 0) return reject('Error: Usuario no encontrado'); 

            const user = results.rows[0]; 
            const isMatch = await bcrypt.compare(password, user.password); 
            isMatch ? resolve(user) : reject('Contraseña incorrecta'); 
        }); 
    }); 
}

// Obtener todos los usuarios
const getAllUsers = async () => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM users';
    pool.query(sql, (error, results) => {
      if (error) return reject(error);
      resolve(results.rows);
    });
  });
}

// Obtener usuario por ID
const getOneUser = async (id) => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM users WHERE id = $1';
    pool.query(sql, [id], (error, results) => {
      if (error) return reject(error);
      resolve(results.rows);
    });
  });
}

