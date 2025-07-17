const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  title: String,
  slug: String,
  description: String,
  image: String,
  authorEmail: String,
  authorName: String,
  category:
  {
    type: String, 
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Post", postSchema);