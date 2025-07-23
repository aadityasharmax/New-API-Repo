// Import required modules
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const slugify = require('slugify');

const userModel = require('./models/user');
const postModel = require('./models/post');

const app = express();

const Category = require('./models/category');

app.set('view engine', 'ejs');

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());



// Authentication middleware
function authenticateUser(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.redirect('/login');
  }
  try {
    const decoded = jwt.verify(token, 'pass');
    req.user = decoded;
    next();
  } catch (err) {
    res.clearCookie('token');
    return res.redirect('/login');
  }
}


// Already Loggedin Middleware 

function redirectIfAuthenticated(req, res, next) {
  const token = req.cookies.token;
  if (!token){
    return next(); 
  }

  try {
    jwt.verify(token, 'pass'); 
    return res.redirect('/dashboard'); 
  } 
  
  catch (err) {
    res.clearCookie('token'); 
    return next();
  }
}



// Admin-only middleware
function requireAdmin(req, res, next) {
  const token = req.cookies.adminToken; // use adminToken
  if (!token) {
    return res.redirect('/admin/login'); // redirect to admin login
  }
  try {
    const decoded = jwt.verify(token, 'pass');
    if (!decoded.isAdmin) return res.status(403).send('Unauthorized');
    req.admin = decoded; 
    next();
  }
   catch (err) {
    res.clearCookie('adminToken');
    return res.redirect('/admin/login');
  }
}




// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });



// Admin Login - get

app.get('/admin/login', (req,res) => {
  res.render('admin-login')
})



// Admin login - post 


app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  const admin = await userModel.findOne({ email, isAdmin: true });

  if (!admin){
    return res.send('Invalid admin credentials');
  }

  const match = await bcrypt.compare(password, admin.password);
  if (!match){
     return res.send('Invalid admin credentials');
  }

  const token = jwt.sign({ email: admin.email, isAdmin: true }, 'pass');
  res.cookie('adminToken', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });

  res.redirect('/admin');
});




// Admin Logout 

app.get('/admin/logout', (req, res) => {
  res.clearCookie('adminToken');
  res.redirect('/admin/login');
});


// Route: Registration / Login Page
app.get('/register-login',redirectIfAuthenticated, (req, res) => {
  res.render('index', { form: {}, errors: {} });
});


// Home page category view 

// Route: Show all categories
app.get('/categories', async (req, res) => {

  try {
    const categories = await Category.find().sort({ name: 1 }); // Sort alphabetically
    res.render('categories', { categories });
  } 
  
  catch (err) {
    console.error(err);
    res.status(500).send('Error loading categories page');
  }
});



// Route: Home Page (show all posts)


app.get('/', redirectIfAuthenticated, async (req, res) => {

  try {
    const selectedCategory = req.query.category || 'all';


    const categories = await Category.find({ isActive: true }).select('name -_id');

    // Fetch posts based on category

    let posts;
    if (selectedCategory === 'all') {
      posts = await postModel.find().sort({ createdAt: -1 });
    } 
    
    else {
      posts = await postModel.find({ category: selectedCategory }).sort({ createdAt: -1 });
    }


    res.render('home', { posts, categories: categories.map(cat => cat.name), selectedCategory : "all" });

  }

  catch (err) {
    console.error(err);
    res.status(500).send('Error loading home page');
  }
});



// Route: User Registration
app.post('/create', async (req, res) => {

  try {
    const { username, email, password, age } = req.body;

    if (!username || !email || !password || !age) {
      return res.send('All fields required');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await userModel.create({
      username,
      email,
      password: hashedPassword,
      age: Number(age),
      isAdmin: false
    });

    const token = jwt.sign({ username, email, age }, 'pass');
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/dashboard');
  } 
  
  catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// Route: Login (render login page)
app.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login')
})


// Route: Handle login form
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await userModel.findOne({ email, isAdmin: false });

  if (!user) {
    return res.send('Invalid email or password');
  }

  bcrypt.compare(password, user.password, (err, result) => {
    if (result) {
      res.clearCookie('adminToken');  

      const token = jwt.sign(
        { username: user.username,
          email: user.email,
          age: user.age 
        },'pass');

      res.cookie('token', token, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      if (user.isAdmin) {
  return res.redirect('/admin/login');
}

      return res.redirect('/dashboard');  
    } 
    
    else {
      res.send('Invalid email or password');
    }
  });
});



// Route: Show Create Post Form
app.get('/post/create', authenticateUser, async (req, res) => {
  const activeCategories = await Category.find({ isActive: true });
  res.render('create-post', { categories: activeCategories, user: req.user });

});



// Route: Handle Create Post Form
app.post('/post/create', authenticateUser, upload.single('image'), async (req, res) => {
  const { title, slug, category, description } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : '';

  // Generate unique slug
  let finalSlug = slug ? slugify(slug, { lower: true, strict: true }) : slugify(title, { lower: true, strict: true });
  const existing = await postModel.findOne({ slug: finalSlug });
  if (existing){
    finalSlug = `${finalSlug}-${Date.now()}`;
  }

  await postModel.create({
    title,
    slug: finalSlug,
    description,
    category,
    image,
    authorEmail: req.user.email,
    authorName: req.user.username
  });
  res.redirect('/dashboard');
}
);


// Edit user info 

app.get('/edit', authenticateUser, async (req, res) => {
  const user = await userModel.findOne({ email: req.user.email });

  if (!user){
    return res.status(404).send('User not found');
  }

  res.render('edit', { user });
});



// Post 

// Handle Edit Account Form (User)

app.post('/edit', authenticateUser, async (req, res) => {
  const { username, email, age, password } = req.body;

  const updatedData = { username, email, age };

  // If password is changed
  if (password && password.trim() !== '') {
    updatedData.password = await bcrypt.hash(password, 10);
  }

  await userModel.findOneAndUpdate({ email: req.user.email }, updatedData);

  // Update JWT (in case email or username changes)
  const token = jwt.sign(
    { username: updatedData.username, email: updatedData.email, age: updatedData.age },
    'pass'
  );
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });

  res.redirect('/dashboard');
});



// Dashboard Route 
app.get('/dashboard', authenticateUser, async (req, res) => {
  try {
    const posts = await postModel.find({ authorEmail: req.user.email }).sort({ createdAt: -1 });
    res.render('dashboard', { user: req.user, posts });
  }
  
  catch (err) {
    console.error(err);
    res.status(500).send('Error loading dashboard');
  }
});


// Route: Show Edit Post Form
app.get('/post/edit/:id', authenticateUser, async (req, res) => {
  const post = await postModel.findById(req.params.id);
  if (!post || post.authorEmail !== req.user.email) {
    return res.status(403).send('Unauthorized');
  }
  res.render('edit-post', { post });
});


// Route: Handle Edit Post Form
app.post('/post/edit/:id', authenticateUser, upload.single('image'), async (req, res) => {
  const { title, slug, description } = req.body;
  let finalSlug = slug ? slugify(slug, { lower: true, strict: true }) : slugify(title, { lower: true, strict: true });

  const existing = await postModel.findOne({
    slug: finalSlug,
    _id: { $ne: req.params.id }
  });

  if (existing) {
    finalSlug = `${finalSlug}-${Date.now()}`;
  }
  const updatedData = { title, slug: finalSlug, description };

  if (req.file) {
    updatedData.image = `/uploads/${req.file.filename}`;
  }

  await postModel.findByIdAndUpdate(req.params.id, updatedData);
  res.redirect('/dashboard');
}
);


// Route: Delete Post
app.post('/post/delete/:id', authenticateUser, async (req, res) => {
  const post = await postModel.findById(req.params.id);
  if (!post) {
    return res.status(404).send('Post not found');
  }
  if (post.authorEmail !== req.user.email) {
    return res.status(403).send('Unauthorized');
  }
  await postModel.findByIdAndDelete(req.params.id);
  res.redirect('/dashboard');
});


// Show user posts when user click username on Home Page

// Route: Show posts by a specific author
app.get('/posts/:authorName', async (req, res) => {
  try {
    const authorName = req.params.authorName;
    const posts = await postModel.find({ authorName }).sort({ createdAt: -1 });

    if (!posts || posts.length === 0) {
      return res.render('author-posts', { posts: [], authorName });
    }

    res.render('author-posts', { posts, authorName });
  } 
  
  catch (err) {
    console.error(err);
    res.status(500).send('Error fetching author posts');
  }
});



// Category filter when user click category under each post 

// Route: Show Posts by Category
app.get('/category/:name', async (req, res) => {
  try {
    const categoryName = req.params.name;

    const categories = await Category.find({ isActive: true }).select('name -_id');

    // Fetch posts for this category
    const posts = await postModel.find({ category: categoryName }).sort({ createdAt: -1 });

    res.render('home', { 
      posts, 
      categories: categories.map(cat => cat.name),
      selectedCategory: categoryName
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading category posts');
  }
});




// Admin Routes

// Admin Dashboard: View all non-admin users
app.get('/admin', requireAdmin, async (req, res) => {
  const users = await userModel.find({ isAdmin: false });
  res.render('admin-dashboard', { users });
});

// Admin: View all posts
app.get('/admin/posts', requireAdmin, async (req, res) => {
  const posts = await postModel.find().sort({ createdAt: -1 });
  res.render('admin-posts', { posts });
});


// Admin edit user info 

// Show Edit User Form
app.get('/admin/edit/:id', requireAdmin, async (req, res) => {
  try {
    const user = await userModel.findById(req.params.id);
    if (!user) return res.status(404).send('User not found');
    res.render('admin-edit-user', { user });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Handle Edit User Form
app.post('/admin/edit/:id', requireAdmin, async (req, res) => {
  try {
    const { username, email, age } = req.body;
    await userModel.findByIdAndUpdate(req.params.id, { username, email, age });
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating user');
  }
});


// Admin: Show Edit Post Form
app.get('/admin/post/edit/:id', requireAdmin, async (req, res) => {
  try {
    const post = await postModel.findById(req.params.id);
    const categories = await Category.find({ isActive: true }); // Fetch active categories
    
    if (!post){
       return res.status(404).send('Post not found');
    }
    res.render('admin-edit-post', { post, categories });
  } 
  
  catch (error) {
    console.error(error);
    res.status(500).send('Error loading post edit page');
  }
});


// Admin categories

app.get('/admin/categories', requireAdmin, async (req, res) => {
  const categories = await Category.find();
  res.render('admin-categories', { categories });
});

// Toggle active / inactive

app.post('/admin/category/toggle/:id', requireAdmin, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).send('Category not found');
    }

    category.isActive = !category.isActive;
    await category.save();

    res.redirect('/admin/categories');
  } 
  
  catch (err) {
    console.error(err);
    res.status(500).send('Error toggling category status');
  }
});


// Add category

// Show Add Category Form
app.get('/admin/category/add', requireAdmin, (req, res) => {
  res.render('admin-add-category');
});

// Handle Add Category Form
app.post('/admin/category/add', requireAdmin, upload.single('image'), async (req, res) => {

  console.log("BODY:", req.body);
  console.log("FILE:", req.file);

  try {
    const { name } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : '';

    if (!name || !image) {
      return res.status(400).send("Category name and image are required");
    }

    await Category.create({ name: name.trim(), image });
    res.redirect('/admin/categories');
  } 
  
  catch (error) {
    console.error(error);
    res.status(500).send('Error adding category');
  }
});

// Admin: Handle Edit Post Form
app.post('/admin/post/edit/:id', requireAdmin, upload.single('image'), async (req, res) => {
  const { title, slug, description, category } = req.body;
  let finalSlug = slug ? slugify(slug, { lower: true, strict: true }) : slugify(title, { lower: true, strict: true });

  const existing = await postModel.findOne({
    slug: finalSlug,
    _id: { $ne: req.params.id }
  });
  if (existing){
     finalSlug = `${finalSlug}-${Date.now()}`;
  }

  const updatedData = { title, slug: finalSlug, description, category };
  if (req.file){
     updatedData.image = `/uploads/${req.file.filename}`;
  }

  await postModel.findByIdAndUpdate(req.params.id, updatedData);
  res.redirect('/admin/posts');
}
);

// Admin: Delete User and their Posts

app.post('/admin/delete/:id', requireAdmin, async (req, res) => {
  console.log("User ID to delete:", req.params.id); // Debugging
  const user = await userModel.findById(req.params.id);
  if (!user){
     return res.status(404).send('User not found');
  }

  await postModel.deleteMany({ authorEmail: user.email });
  await userModel.findByIdAndDelete(req.params.id);
  res.redirect('/admin');
});

// Admin delete posts

app.post('/admin/post/delete/:id', requireAdmin, async (req, res) => {
  const post = await postModel.findById(req.params.id);
  if (!post) {
    return res.status(404).send('Post not found');
  }

  await postModel.findByIdAndDelete(req.params.id)
  res.redirect('/admin/posts');
})


// Logout route
app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.clearCookie('adminToken');
  res.redirect('/');
});

// Ensure Default Admin User Exists
async function ensureDefaultAdmin() {
  const existingAdmin = await userModel.findOne({ email: 'admin@example.com' });
  if (existingAdmin) return;
  const adminHashedPw = await bcrypt.hash('Admin@123', 10);
  await userModel.create({
    username: 'Admin',
    email: 'admin@example.com',
    password: adminHashedPw,
    age: 30,
    isAdmin: true
  });
}
ensureDefaultAdmin();



// Start server
app.listen(3000, () => console.log('Server running'));


