const userService = require('../services/usersService'); 

const getAllUsers = async() => {
    const users = userService.getAllUsers(); 
    return users; 
}

const getOneUser = async(id) => {
    const users = userService.getOneUser(id); 
    return users; 
}

const createUser = async(name, email, phone, points, authentication_token, strip_image_url) => {
    const users = userService.createUser(name, email, phone, points, authentication_token, strip_image_url); 
    return users; 
}

const updateUser = async(id) => {
    const users = userService.updateUser(name, email, phone, points, authentication_token, strip_image_url, id); 
    return users; 
}

const deleteUser = async(id) => {
    const users = userService.deleteUser(name, email, phone, points, authentication_token, strip_image_url, id); 
    return users; 
}

module.exports = {
    getAllUsers,
    getOneUser,
    createUser,
    updateUser,
    deleteUser,
};