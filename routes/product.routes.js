const express = require("express");
const router = express.Router();
const productController = require("../controllers/product.controller");
const upload = require("../middleware/upload");

// Middleware: chấp nhận upload nhiều loại trường
const multiUpload = upload.fields([
  { name: "image", maxCount: 1 },        // Ảnh đại diện
  { name: "images", maxCount: 10 }       // Danh sách ảnh
]);

// GET - danh sách sản phẩm
router.get("/", productController.getAllProducts);

// GET -  ctiet danh sách sản phẩm
router.get("/:id", productController.getProductById);

// POST - thêm sản phẩm
router.post("/", multiUpload, productController.createProduct);

// PUT - cập nhật sản phẩm
router.put("/:id", multiUpload, productController.updateProduct);

// DELETE - xóa sản phẩm
router.delete("/:id", productController.deleteProduct);


module.exports = router;
