const cookieParser = require('cookie-parser');
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userModel = require('./models/user');
const multer = require('multer');



const app = express();
app.set("view engine", "ejs");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());



// Middleware to authenticate

const authenticateUser = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.redirect('/login');
  }

  else {
    try {
      const decoded = jwt.verify(token, "pass");
      req.user = decoded;
      next();
    }

    catch (err) {

    }
  }


};



// ------- Multer Setup ----- 


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });




// ------ Post Upload Route ------- >

const postModel = require('./models/post');

app.get('/post/create', authenticateUser, (req, res) => {
  res.render("create-post", { user: req.user });
});

app.post('/post/create', authenticateUser, upload.single('image'), async (req, res) => {
  const { title, slug, description } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : "";

  await postModel.create({
    title,
    slug,
    description,
    image,
    authorEmail: req.user.email,
    authorName: req.user.username
  });

  res.redirect('/profile');
});


// ----- Edit Route ---->

app.get('/post/edit/:id', authenticateUser, async (req, res) => {
  const post = await postModel.findById(req.params.id);
  if (!post || post.authorEmail !== req.user.email) {
    return res.status(403).send("Unauthorized");
  }
  res.render("edit-post", { post }); 
});

app.post('/post/edit/:id', authenticateUser, upload.single('image'), async (req, res) => {
  const post = await postModel.findById(req.params.id);
  if (!post || post.authorEmail !== req.user.email) {
    return res.status(403).send("Unauthorized");
  }

  const { title, slug, description } = req.body;
  const updatedData = {
    title,
    slug,
    description
  };

  if (req.file) {
    updatedData.image = `/uploads/${req.file.filename}`;
  }

  await postModel.findByIdAndUpdate(req.params.id, updatedData);
  res.redirect("/profile");
});


// ---- Delete Post ------->

app.get('/post/delete/:id', authenticateUser, async (req, res) => {
  const post = await postModel.findById(req.params.id);
  if (!post || post.authorEmail !== req.user.email){
    return res.status(403).send('Unauthorized');
  }


  else{
    await postModel.findByIdAndDelete(req.params.id);
  res.redirect('/profile');
  }
  
});

app.post('/post/delete/:id', authenticateUser, async (req, res) => {
  try {
    const post = await postModel.findById(req.params.id);

    if (!post) {
      return res.status(404).send('Post not found');
    }

    // Only the author can delete the post
    if (post.authorEmail !== req.user.email) {
      return res.status(403).send('Unauthorized');
    }

    await postModel.findByIdAndDelete(req.params.id);
    res.redirect('/profile');
  } 
  
  catch (error) {
    console.error(error);
    res.status(500).send('Error deleting post');
  }
});



//  Check user for admin

const isAdmin = (req, res, next) => {

  const token = req.cookies.token;

  if (!token) {
    return res.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, "pass");

    userModel.findOne({ email: decoded.email }).then(user => {
      if (!user || !user.isAdmin){
        return res.status(403).render("login")
      }

      else{
        req.user = user;
      }
      
      next();
    });
  } 
  
  catch (err) {

    res.redirect('/login');
  }
};


// Home Page


app.get("/", async (req, res) => {
  const posts = await postModel.find().sort({ createdAt: -1 });
  res.render("home", { posts });
});


// New User Registration


app.post('/create', async (req, res) => {
  try {
    const { username, email, password, age } = req.body;

    const errors = {};

    // Validations
    if (!username){
      errors.username = "Username is required";
    }
    if (!email) {
      errors.email = "Email is required";
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) errors.email = "Invalid email format";
    }

    if (!password) {
      errors.password = "Password is required";
    } else if (password.length < 6) {
      errors.password = "Password must be at least 6 characters";
    } else {
      const strongPasswordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{6,}$/;
      if (!strongPasswordRegex.test(password)) {
        errors.password = "Password must include uppercase, number, and special character";
      }
    }

    if (!age) {
      errors.age = "Age is required";
    } 
    
    else if (isNaN(age)) {
      errors.age = "Age must be a number";
    }
    
    else if (age.length > 3) {
      errors.age = "Invalid age";
    } 

    
    

    //  Hash
    const hash = await bcrypt.hash(password, 10);
    await userModel.create({
      username,
      email,
      password: hash,
      age: Number(age),
      isAdmin: false, 
    });



    //  Issue JWT
    const token = jwt.sign({ username, email, age }, "pass");
    res.cookie("token", token, { httpOnly: true });

    res.redirect("/dashboard");

  } catch (error) {
    console.error("Error in /create:", error);
    res.status(500).send("Server error");
  }
});


// User Delete Functionality 

    app.post('/admin/delete/:id', isAdmin, async (req, res) => {
  try {

    await userModel.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } 
  
  catch (err) {

    console.error("Error deleting user:", err);
    res.status(500).send("Failed to delete user");
  }
});



//  Login Route

app.get('/login', (req, res) => {
  res.render("login")
});


// Login Login 
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await userModel.findOne({ email });

  if (!user) return res.send("Invalid email or password");

  bcrypt.compare(password, user.password, (err, result) => {
    if (result) {
      const token = jwt.sign({
        username: user.username,
        email: user.email,
        age: user.age
      }, "pass");

      res.cookie("token", token, { httpOnly: true });

      
      if (user.isAdmin) {
        res.redirect("/admin");
      } else {
        res.redirect("/dashboard");
      }

    } else {
      res.send("Invalid email or password");
    }
  });
});
 

// User Dashboard
app.get('/dashboard', authenticateUser, (req, res) => {
  res.render("dashboard", { user: req.user });
});


// User Profile

app.get('/profile', authenticateUser, async (req, res) => {
  const posts = await postModel.find({ authorEmail: req.user.email });
  res.render("profile", { user: req.user, posts });
});







// Admin 
app.get('/admin', isAdmin, async (req, res) => {
  try {
    const users = await userModel.find({ isAdmin: false });
    res.render("admin-dashboard", { users });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).send("Internal server error");
    
  }
});


// Edit get

app.get('/edit', authenticateUser, async (req, res) => {
  try {
    const user = await userModel.findOne({ email: req.user.email });
    if (!user){
      return res.status(404).send("User not found");
    }

    else{
      res.render("edit", { user });
    }
  } 
  
  catch (err) {
    console.error("Error loading edit page:", err);
    res.status(500).send("Server error");
  }

});


// Edit Post Functionality


app.post('/edit', authenticateUser, async (req, res) => {
  try {
    const { username, email, age } = req.body;

    await userModel.updateOne(
      { email: req.user.email },
      {
        username,
        email,
        age: Number(age)
      }
    );

    // Re-issue JWT if email was changed
    const token = jwt.sign({ username, email, age }, "pass");
    res.cookie("token", token, { httpOnly: true });

    res.redirect("/profile");
  } 
  catch (err) {
    console.error("Error updating user:", err);
    res.status(500).send("Failed to update profile");
  }
});

// Register Login 

app.get('/register-login',(req,res) => {
  res.render("index" , {form : {} , errors : {}})
})


// Logout
app.get('/logout', (req, res) => {
  res.clearCookie("token");
  res.redirect('/');
});

// Default admin
async function createAdmin() {
  const existing = await userModel.findOne({ email: "admin@example.com" });
  if (existing) return;

  const hashed = await bcrypt.hash("Admin@123", 10);
  await userModel.create({
    username: "Admin",
    email: "admin@example.com",
    password: hashed,
    age: 30,
    isAdmin: true,
  });

  console.log("Admin created");
}
createAdmin();


app.listen(3000, () => console.log("Server running"));
