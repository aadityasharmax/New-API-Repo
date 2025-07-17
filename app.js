const cookieParser = require('cookie-parser');
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userModel = require('./models/user');
const multer = require('multer');
const slugify = require('slugify');
const postModel = require('./models/post');

const app = express();
app.set("view engine", "ejs");

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

// Auth Middleware
const authenticateUser = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.redirect('/login');
  }

  else{

    try {
    const decoded = jwt.verify(token, "pass");
    req.user = decoded;
    next();
  } 
  
    catch (err) {
    res.clearCookie("token");
    return res.redirect('/login');
  }
  }
};



// Admin Middleware


const isAdmin = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.redirect('/login');
  }

  else {
    try {
      const decoded = jwt.verify(token, "pass");
      userModel.findOne({ email: decoded.email }).then(user => {
        if (!user || !user.isAdmin) {
          return res.status(403).send("Unauthorized");
        }
        else {
          req.user = user;
          next();
        }
      });
    }

    catch (err) {
      res.redirect('/login');
    }
  }

};

// Multer setup for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ storage });


// Register / Login  

app.get('/register-login', (req, res) => {
  res.render("index", { form: {}, errors: {} })
});



// Routes
app.get("/", async (req, res) => {
  const posts = await postModel.find().sort({ createdAt: -1 });
  res.render("home", { posts });
});



// Register
app.post('/create', async (req, res) => {
  try {
    const { username, email, password, age } = req.body;

    // Basic validations
    if (!username || !email || !password || !age) return res.send("All fields required");

    const hash = await bcrypt.hash(password, 10);
    await userModel.create({ 
      username,
      email,
      password: hash,
      age: Number(age),
      isAdmin: false 
    });

    const token = jwt.sign({ username, email, age }, "pass");
    res.cookie("token", token, { httpOnly: true });
    res.redirect("/dashboard");
  } 
  
    catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});



// Login
app.get('/login', (req, res) => res.render("login"));
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await userModel.findOne({ email });


  if (!user){
    return res.send("Invalid email or password");
  }

  bcrypt.compare(password, user.password, (err, result) => {
    if (result) {
      const token = jwt.sign({ 
      username: user.username,
      email: user.email,
      age: user.age 
    }, "pass");

      res.cookie("token", token, { httpOnly: true });
      return res.redirect(user.isAdmin ? "/admin" : "/dashboard");
    } 
    
    else{
      res.send("Invalid email or password");
    }
  });
});



// Dashboard & Profile
app.get('/dashboard', authenticateUser, async (req, res) => {
  const posts = await postModel.find({ authorEmail: req.user.email });
  res.render("dashboard", { user: req.user, posts });
});



// Create Post
app.get('/post/create', authenticateUser, (req, res) => res.render("create-post", { user: req.user }));
app.post('/post/create', authenticateUser, upload.single('image'), async (req, res) => {
  const { title, slug, category,description } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : "";

  // Unique slug
  let finalSlug = slug ? slugify(slug, { lower: true, strict: true }) : slugify(title, { lower: true, strict: true });
  const existing = await postModel.findOne({ slug: finalSlug });
  if (existing) finalSlug = `${finalSlug}-${Date.now()}`;

  await postModel.create({ title, slug: finalSlug, description,category, image, authorEmail: req.user.email, authorName: req.user.username });
  res.redirect('/dashboard');
});



// Edit Post (User)
app.get('/post/edit/:id', authenticateUser, async (req, res) => {
  const post = await postModel.findById(req.params.id);
  if (!post || post.authorEmail !== req.user.email) return res.status(403).send("Unauthorized");
  res.render("edit-post", { post });
});
app.post('/post/edit/:id', authenticateUser, upload.single('image'), async (req, res) => {
  const { title, slug, description } = req.body;
  let finalSlug = slug ? slugify(slug, { lower: true, strict: true }) : slugify(title, { lower: true, strict: true });

  const existing = await postModel.findOne({ slug: finalSlug, _id: { $ne: req.params.id } });
  if (existing) finalSlug = `${finalSlug}-${Date.now()}`;

  const updatedData = { title, slug: finalSlug, description };
  if (req.file) updatedData.image = `/uploads/${req.file.filename}`;

  await postModel.findByIdAndUpdate(req.params.id, updatedData);
  res.redirect("/dashboard");
});

// Delete Post
app.post('/post/delete/:id', authenticateUser, async (req, res) => {
  const post = await postModel.findById(req.params.id);
  if (!post) return res.status(404).send('Post not found');
  if (post.authorEmail !== req.user.email) return res.status(403).send('Unauthorized');
  await postModel.findByIdAndDelete(req.params.id);
  res.redirect('/dashboard');
});

// Admin Routes
app.get('/admin', isAdmin, async (req, res) => {
  const users = await userModel.find({ isAdmin: false });
  res.render("admin-dashboard", { users });
});
app.get('/admin/posts', isAdmin, async (req, res) => {
  const posts = await postModel.find().sort({ createdAt: -1 });
  res.render('admin-posts', { posts });
});
app.get('/admin/post/edit/:id', isAdmin, async (req, res) => {
  const post = await postModel.findById(req.params.id);
  if (!post) return res.status(404).send('Post not found');
  res.render('admin-edit-post', { post });
});
app.post('/admin/post/edit/:id', isAdmin, upload.single('image'), async (req, res) => {
  const { title, slug, description } = req.body;
  let finalSlug = slug ? slugify(slug, { lower: true, strict: true }) : slugify(title, { lower: true, strict: true });

  const existing = await postModel.findOne({ slug: finalSlug, _id: { $ne: req.params.id } });
  if (existing){
    finalSlug = `${finalSlug}-${Date.now()}`;
  }

  const updatedData = { title, slug: finalSlug, description };
  if (req.file){
    updatedData.image = `/uploads/${req.file.filename}`;
  }

  await postModel.findByIdAndUpdate(req.params.id, updatedData);
  res.redirect('/admin/posts');
});
app.post('/admin/delete/:id', isAdmin, async (req, res) => {
  const user = await userModel.findById(req.params.id);
  if (!user){
    return res.status(404).send('User not found');
  }

  await postModel.deleteMany({ authorEmail: user.email });
  await userModel.findByIdAndDelete(req.params.id);
  res.redirect('/admin');
});

// Logout
app.get('/logout', (req, res) => {
  res.clearCookie("token");
  res.redirect('/');
});

// Create default admin
async function createAdmin() {
  const existing = await userModel.findOne({ email: "admin@example.com" });
  
  if (existing) return;
  const hashed = await bcrypt.hash("Admin@123", 10);
  await userModel.create({ 
  username: "Admin",
  email: "admin@example.com",
  password: hashed,
  age: 30,
  isAdmin: true 
  });
}
createAdmin();

app.listen(3000, () => console.log("Server running"));
