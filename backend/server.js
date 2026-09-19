require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const app = express();
app.use(cors());
app.use(express.json());
const pool = new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL&&process.env.DATABASE_URL.includes("localhost")?false:{rejectUnauthorized:false}});
app.get("/api/health",async(_req,res)=>{try{await pool.query("SELECT 1");res.json({ok:true,database:"reachable"});}catch(_err){res.status(503).json({ok:false,error:"database unavailable"});}});
app.get("/api/items",async(_req,res)=>{const result=await pool.query("SELECT id,title,created_at FROM items ORDER BY created_at DESC");res.json(result.rows);});
app.post("/api/items",async(req,res)=>{
  const title=typeof req.body.title==="string"?req.body.title:"";
  if(title.trim().length===0)return res.status(400).json({error:"title is required"});
  const result=await pool.query("INSERT INTO items (title) VALUES ($1) RETURNING id,title,created_at",[title]);
  res.status(201).json(result.rows[0]);
});
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:"unexpected server error"});});
const port=process.env.PORT||3000;app.listen(port,()=>console.log(`API listening on ${port}`));
