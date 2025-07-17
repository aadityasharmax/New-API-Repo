const mongoose = require('mongoose');

mongoose.connect(`mongodb://127.0.0.1:27017/authtestapp`);





const userSchema = mongoose.Schema({
    username: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        match: /.+\@.+\..+/ 
    },
    password: {
        type: String,
        required: true,
    minlength: 6
  },
  age: {
      type: Number,
      min: 1
  },
  isAdmin: {
        type: Boolean,
        default: false
      }
});


module.exports =  mongoose.model("user",userSchema)