const usersDb = require('../db/usersDB'); 

const getAllUsers = async() => {
    const users = usersDb.getAllUsers(); 
    return users; 
}

const getOneUser = async(id) => {
    const users = usersDb.getOneUser(id); 
    return users; 
}

const createUser = async(name, email, phone, points, authentication_token, strip_image_url) => {
    const users = usersDb.createUser(name, email, phone, points, authentication_token, strip_image_url); 
    return users; 
}

const updateUser = async(id) => {
    const users = usersDb.updateUser(name, email, phone, authentication_token, strip_image_url, id); 
    return users; 
}

const deleteUser = async(id) => {
    const users = usersDb.deleteUser(name, email, phone, points, authentication_token, strip_image_url, id); 
    return users; 
}

module.exports = {
    getAllUsers,
    getOneUser,
    createUser,
    updateUser,
    deleteUser,
};