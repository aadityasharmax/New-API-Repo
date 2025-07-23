const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },

    image: {type: String, required: true},

  isActive: { type: Boolean, default: true },

  createdAt: { type: Date, default: Date.now }
})

module.exports = mongoose.model('Category', categorySchema);