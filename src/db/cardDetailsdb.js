const dbConnection = require('./dbConection'); 
const dbLocal = require('./dbConectionLocal'); 

let pool; 

(async () => {
  try {
    await dbConnection.connect(); 
    console.log('Conexión con la db remota exitosa: CardDetails'); 
    pool = dbConnection; 
  } catch (errRemota){
    console.warn('Error con la db remota. Intentando conexión local... ', errRemota.message); 

    try {
      await dbLocal.connect(); 
      console.log('Conexión con la db local exitosa: CardDetails'); 
      pool = dbLocal; 
    } catch (errLocal){
      console.error('Error al conectar con la db local: ', errLocal.message); 
    }
  }
})(); 

const getAllCardDetails = async () => {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT * FROM card_details'; 
        pool.query(sql, (error, results) => {
            if(error) return reject(error); 
            resolve(results.rows); 
        }); 
    }); 
}

const getOneCardDetails = async (id) => {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT * FROM card_details WHERE id = $1'; 
        pool.query(sql, [id], (error, resutls) => {
            if(error) return reject(error); 
            resolve(resutls.rows); 
        }); 
    }); 
}


const createOneCardDetails = async (business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at) => {
    return new Promise((resolve, reject) => {
        const sql = `
            INSERT INTO card_details
                (business_id, background_color, foreground_color, pass_type_id, 
                terms, logo_url, strip_image_url, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`; 
        pool.query(sql, [business_id, background_color, foreground_color, pass_type_id, 
            terms, logoBuffer, strip_imageBuffer, created_at, updated_at], (error, results) => {
                if(error) return reject(error); 
                resolve(results.rows[0]); 
        }); 
    }); 
}

const updateCardDetails = async (business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at, id) => {
    return new Promise (async (resolve, reject) => {
        const sql = `
            UPDATE card_details 
            SET 
                business_id = $1, 
                background_color = $2, 
                foreground_color = $3, 
                pass_type_id = $4, 
                terms = $5, 
                logo_url = $6, 
                strip_image_url = $7, 
                updated_at = $8
            WHERE id = $9
            RETURNING *`; 
        pool.query(sql, [business_id, background_color, foreground_color, pass_type_id, terms, logoBuffer, strip_imageBuffer, created_at, updated_at, id], (error, results) => {
            if (error) return reject(error); 
            resolve('CardDetail actualizado'); 
        }); 
    }); 
}

const deleteCardDetails = async (id) => {
    return new Promise(async (resolve, reject) => {
        const sql = `DELETE FROM card_details WHERE id = $1 `; 
        pool.query(sql, [id], (error, results) => {
            if(error) return reject(error); 
            resolve('CardDetail Eliminado'); 
        });
    }); 
}




module.exports = {
    getAllCardDetails,
    getOneCardDetails,
    createOneCardDetails,
    updateCardDetails, 
    deleteCardDetails
}