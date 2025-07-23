const express = require('express');
const app = express();
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const path = require('path')
const multer = require('multer');
const slugify = require('slugify');
const bcrypt = require('bcrypt');


const userModel = require('./models/user');
const postModel = require('./models/post');


app.set('view engine','ejs')

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

// Authentication Function

const authenticateUser = (req , res , next) => {
    const token = req.cookies.token;
    if(!token){
        res.redirect('/login')
    }

    else{
        try{
            const decoded = jwt.verify(token,'pass');
            req.user = decoded;
            next()
        }
        catch(err){
            res.clearCookie('token');
            return res.redirect('/login');
        }
    }
}


// Check admin 

const requireAdmin = (req, res, next) => {
    const token = req.cookies.token;
    if(!token){
        res.redirect('/login')
    }

    try{
        const decoded = jwt.verify(token,'pass');
        userModel.findOne({email : decoded.email}).then(user => {
            if(!user || !user.isAdmin){
                return res.status(403).send("Unauthorized")
            }
            req.user = user;
            next()
        })
    }
    catch(err){
        res.redirect('/login')
    }
}


// Configure multer for file upload 

const storage = multer.diskStorage({
    destination :   (req, res, cb) => cb(null, 'public/uploads'),
    filename : (req, res, cb) => cb(null, `${Date.now()}-${File.originalName}`)

});
const upload = multer({storage});


// Home Page - Show all posts

app.get('/', async (req,res) => {
    const posts = await postModel.find().sort({createdAt :-1});
    res.render("home", {posts})
})



// Registeration Login Page

app.post('/register-login',(req,res) => {
    res.render("index",{form : {}, error : {}})
})


// New User registration - Post 

app.post('/create',async (req,res) => {
    try{
        const {username, age, email, password} = req.body;
        if(!username || !age || !email || !password){
            res.send("All fields are required")
        }

        const hashedPassword = await bcrypt.hash(password,10);
        await userModel.create({
            username,
            age : Number(age),
            email,
            password : hashedPassword,
            isAdmin : false
        })


        const token = bcrypt.sign.hash({username,email,age}, 'pass');
        res.cookie('token', token, {httpOnly: true});
        res.redirect('/dashboard')
    }
    catch(err){
        console.error(err);
        res.status(500).send("Server Error")
    }
});



// Route: Login (render login page)
app.get('/login', (req, res) => {
  res.render('login')
})

// Handle Login Form 

app.post('/login', async (req,res) => {
    const {email, password} = req.body;
    const user = await userModel.findOne({email});

    if(!user){
        return res.send("Invalid Email or Password");
    }

    bcrypt.compare(password,user.password,(err,result) => {
        if(result){
            const token = jwt.sign({
                username : user.username,
                email : user.email,
                age : user,age
            }, 'pass')

            res.cookie('token', token, {httpOnly: true});
            return res.redirect(user.isAdmin ? '/admin' : '/dashboard');
        }

        else{
            res.send('Invalid Email or Password')
        }
    })
})

// User Dashboard

app.get('/dashboard', authenticateUser, async (req, res) => {
  const posts = await postModel.find({ authorEmail: req.user.email });
  res.render('dashboard', { user: req.user, posts });
});


// Route: Show Create Post Form
app.get('/post/create', authenticateUser, (req, res) => {
  res.render('create-post', { user: req.user });
});



// Handle Create Post Form 

app.post('/post/create',authenticateUser, upload.single('image'),  async(req,res) => {
    const {title, slug, category, description} = req.body;
    const image = req.file? `/uploads/${req.file.filename}`:'';


    // Generate Slug

    let finalSlug = slug ? slugify(slug, {lower: true, strict: true}) : slugify(title, {lower: true, strict: true} )

    const existing = await postModel.findOne({slug: finalSlug});
    if(existing){
        finalSlug = `${finalSlug}-${Date.now()}`;
    }

        await postModel.create({
            title,
            slug:finalSlug,
            description,
            category,
            image,
            authorEmail: req.user.email,
            authorName: req.user.username
        });

        res.redirect('/dashboard')

});


// Edit post form 

app.get('/post/edit/:id', authenticateUser, async(req,res) => {
    const post = await postModel.findById(req.params.id);

    if(!post || post.authorEmail!= req.user.email){
        res.status(403).send('Unauthorized')
    }
    res.render('edit-post',{post})
})

// Handle edit post form 

app.post('/post/edit/:id', authenticateUser, upload.single('image'), async(req,res) => {
        const {title,slug,description} = req.body;

        let finalSlug = slug ? slugify(slug, {lower : true , strict: true}) 
            : slugify(title, {lower: true, strict: true});

        const existing = await postModel.findOne({
            slug: finalSlug,
            _id : { $ne : req.params.id},
        });

        if (existing){
            finalSlug = `${finalSlug}-${Date.now()}`;
        }

        const updatedData = { title, slug: finalSlug, description };
            if (req.file) updatedData.image = `/uploads/${req.file.filename}`;
        
            await postModel.findByIdAndUpdate(req.params.id, updatedData);
            res.redirect('/dashboard');
})

// Delete Post 

app.post('/post/delete/:id',authenticateUser,async(req,res) => {
    const post = await postModel.findById(req.params.id);

    if(!post){
        return res.status(404).send("Post not found")
    }

    if(post.authorEmail != req.user.email){
        return res.status(403).send("Unauthorized Access")
    }
    await postModel.findByIdAndDelete(req.params.id);
    res.redirect('/dashboard');
})


// Admin Routes

// Admin dashboard

app.get('/admin', requireAdmin, async (req,res) => {
    const users = await userModel.find({isAdmin:false})
    res.render('admin-dashboard', {users})

})

// Admin view all posts

app.get('/admin/posts', requireAdmin, async(req,res) => {
    const posts = await postModel.find().sort({createdAt : -1});
    res.render('admin-posts',{posts})
})


// Show edit post form 

app.get('/admin/post/edit/:id', requireAdmin , async(req,res) => {
    const post = await postModel.findById(req.parama.id);

    if(!post){
        return res.status(404).send('Post not found');    
    }

    res.render('admin-edit-post',{post})
})

// Handle Edit Admin Form 

app.post('/admin/post/edit/:id', requireAdmin, upload.single('image'), async(req,res) => {
    const {title, slug, description} = req.body;

    let finalSlug = slug
          ? slugify(slug, { lower: true, strict: true })
          : slugify(title, { lower: true, strict: true });
    
        const existing = await postModel.findOne({
          slug: finalSlug,
          _id: { $ne: req.params.id }
        });
        if (existing) finalSlug = `${finalSlug}-${Date.now()}`;
    
        const updatedData = { title, slug: finalSlug, description };
        if (req.file) updatedData.image = `/uploads/${req.file.filename}`;
    
        await postModel.findByIdAndUpdate(req.params.id, updatedData);
        res.redirect('/admin/posts');

})


// Admin delete user and their posts

app.post('/admin/delete/:id', requireAdmin, async(req,res) => {
    const user = userModel.findById(req.params.id);
    if(!user){
        return res.status(404).send("User not found")
    }

    await postModel.deleteMany({authorEmail : user.email})
    await userModel.findByIdAndDelete(req.params.id);
    res.redirect('/admin')
})


// Admin delete posts

app.post('/admin/delete/post/:id', requireAdmin, async(req,res) => {
    const post = await postModel.findById(req.params.id);
    if(!post){
        return res.status(404).send("Post not found")
    }

    await postModel.findByIdAndDelete(req.params.id);
    res.redirect('/admin/posts')
})

// Logout route

app.get('/logout',(req,res) => {
    res.clearCookie('token');
    res.redirect('/')
})


//Default admin

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


app.listen(3000, () => {
    console.log("Server Started..")
})