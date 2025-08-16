const Product = require("../models/Product");
const cloudinary = require("../utils/cloudinary");
const path = require("path");
const mongoose = require("mongoose");
const jwt = require('jsonwebtoken');
const wishlistService = require('../services/wishlist.service');
const Comment = require("../models/Comment");



// Kiểm tra có dùng Cloudinary không
const useCloudinary = process.env.USE_CLOUDINARY === "true";

// Lấy đường dẫn URL đúng cho ảnh (local hoặc cloud)
function getImageUrl(file) {
  if (useCloudinary) return file.path; // Cloudinary trả link
  return `/uploads/${file.filename}`;   // Local
}

// Lấy public_id từ link Cloudinary để xoá
function extractPublicId(url) {
  const parts = url.split("/");
  const filename = parts.pop().split(".")[0];
  const folder = "mazone";
  return `${folder}/${filename}`;
}

exports.searchProducts = async (req, res) => {
  try {
    const { name, category } = req.query;
    const filter = {};

    if (name) filter.name = { $regex: name, $options: 'i' };
    if (category) filter.category = { $regex: `^${category}$`, $options: 'i' };

    const products = await Product.find(filter)
      .collation({ locale: 'vi', strength: 1 })
      .sort({ createdAt: -1 });

    res.json(products);
  } catch (err) {
    console.error('Lỗi khi tìm kiếm:', err);
    res.status(500).json({ message: 'Lỗi server khi tìm kiếm' });
  }
};

// Lấy tất cả sản phẩm
exports.getAllProducts = async (req, res) => {
  try {
    const filter = {};

    // Lọc theo 'featured'
    if (req.query.featured === 'true') {
      filter.is_featured = true;
    }

    // Lọc theo 'category'
    if (req.query.category) {
      filter.category = { $regex: `^${req.query.category}$`, $options: 'i' }; // Tìm theo danh mục (không phân biệt hoa thường)
    }

    // Lọc theo 'name' (tìm kiếm theo tên sản phẩm)
    if (req.query.name) {
      filter.name = { $regex: req.query.name, $options: 'i' }; // Tìm kiếm theo tên sản phẩm
    }

    const products = await Product.aggregate([
      { $match: filter },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'comments',
          let: { pid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$product_id', '$$pid'] } } },
            { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
          ],
          as: 'ratingDoc'
        }
      },
      { $addFields: { _r: { $first: '$ratingDoc' } } },
      {
        $addFields: {
          ratingAvg: { $round: [{ $ifNull: ['$_r.avg', 0] }, 1] },
          ratingCount: { $ifNull: ['$_r.count', 0] },
        }
      },
      { $project: { ratingDoc: 0, _r: 0 } },
    ]).collation({ locale: 'vi', strength: 1 });

    if (products.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy sản phẩm phù hợp với yêu cầu tìm kiếm." });
    }

    res.json(products); // Trả về danh sách sản phẩm tìm được
  } catch (err) {
    console.error("Lỗi khi lấy danh sách sản phẩm:", err);
    res.status(500).json({ message: "Lỗi server khi lấy sản phẩm" });
  }
};





// Lấy sản phẩm theo ID
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Không tìm thấy sản phẩm" });

    // Tính rating cho sản phẩm
    const agg = await Comment.aggregate([
      { $match: { product_id: new mongoose.Types.ObjectId(product._id) } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const ratingAvg = Number((agg[0]?.avg || 0).toFixed(1));
    const ratingCount = agg[0]?.count || 0;

    // Kiểm tra isFavorite (như cũ)
    let isFavorite = false;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded?.userId) {
          isFavorite = await wishlistService.isInWishlist(decoded.userId, product._id);
        }
      }
    } catch (_) {
      isFavorite = false;
    }

    // Trả về kèm rating & isFavorite
    return res.json({ ...product.toObject(), ratingAvg, ratingCount, isFavorite });
  } catch (err) {
    console.error("Lỗi khi lấy sản phẩm:", err);
    res.status(500).json({ message: "Lỗi server khi lấy sản phẩm" });
  }
};

// Thêm sản phẩm mới
exports.createProduct = async (req, res) => {
  try {
    const {
      name,
      price,
      category,
      brand,
      description,
      variations: variationsRaw,
    } = req.body;

    if (!name || !category || !brand)
      return res.status(400).json({ message: "Tên, danh mục và thương hiệu là bắt buộc." });

    const priceNum = Number(price);
    if (!price || isNaN(priceNum) || priceNum <= 0)
      return res.status(400).json({ message: "Giá phải là số dương." });

    let parsedDescription = [];
    if (description) {
      try {
        parsedDescription = JSON.parse(description);
        const ok = Array.isArray(parsedDescription) && parsedDescription.every(d => d.field && d.value);
        if (!ok) throw new Error();
      } catch {
        return res.status(400).json({ message: "Trường description không hợp lệ." });
      }
    }

    let variations = [];
    if (variationsRaw) {
      try {
        variations = JSON.parse(variationsRaw);
        const ok = Array.isArray(variations) && variations.every(v => v.color && v.size && !isNaN(v.quantity));
        if (!ok) throw new Error();
      } catch {
        return res.status(400).json({ message: "Trường variations không hợp lệ." });
      }
    }

    const totalQuantity = variations.reduce((sum, v) => sum + Number(v.quantity), 0);
    let statusValue = req.body.status || "Đang bán"; // cho phép admin truyền status thủ công

    // Nếu admin không set "Ngừng bán" thì tự động tính toán theo tồn kho
    if (statusValue !== "Ngừng bán") {
      if (totalQuantity <= 0) {
        statusValue = "Hết hàng";
      } else {
        statusValue = "Đang bán";
      }
    }


    if (!req.files?.image?.[0])
      return res.status(400).json({ message: "Phải có ảnh đại diện (image)." });

    const imageURL = getImageUrl(req.files.image[0]);

    const extraImgs = req.files?.images || [];
    if (extraImgs.length > 6)
      return res.status(400).json({ message: "Tối đa 6 ảnh bổ sung." });

    const images = extraImgs.map(file => getImageUrl(file));

    const product = await Product.create({
      name: name.trim(),
      image: imageURL,
      images,
      description: parsedDescription,
      price: priceNum,
      quantity: totalQuantity,
      category: category.trim(),
      brand: brand.trim(),
      variations,
      status: statusValue,
      is_featured: req.body.is_featured === 'true' || req.body.is_featured === true,
    });

    res.status(201).json(product);
  } catch (err) {
    console.error("Lỗi khi tạo sản phẩm:", err);
    res.status(500).json({ message: "Không thể tạo sản phẩm." });
  }
};

// Cập nhật sản phẩm
exports.updateProduct = async (req, res) => {
  try {
    const updateData = { ...req.body };

    if (typeof req.body.is_featured !== 'undefined') {
      updateData.is_featured = req.body.is_featured === 'true' || req.body.is_featured === true;
    }


    // Parse description
    if (typeof updateData.description === "string") {
      try {
        updateData.description = JSON.parse(updateData.description);
      } catch {
        return res.status(400).json({ message: "Mô tả không hợp lệ." });
      }
    }

    // Parse variations
    if (req.body.variations) {
      try {
        const parsedVariations = JSON.parse(req.body.variations);
        if (!Array.isArray(parsedVariations)) {
          return res.status(400).json({ message: "Variations phải là mảng." });
        }
        for (const v of parsedVariations) {
          if (!v.color || !v.size || isNaN(v.quantity)) {
            return res.status(400).json({ message: "Variation thiếu thông tin." });
          }
        }
        updateData.variations = parsedVariations;
        updateData.quantity = parsedVariations.reduce((sum, v) => sum + Number(v.quantity || 0), 0);
      } catch {
        return res.status(400).json({ message: "Variations không hợp lệ." });
      }
    }
    // Nếu admin không truyền status = "Ngừng bán" thì hệ thống auto tính
    if (typeof updateData.quantity !== "undefined") {
      if (updateData.status !== "Ngừng bán") {
        if (updateData.quantity <= 0) {
          updateData.status = "Hết hàng";
        } else {
          updateData.status = "Đang bán";
        }
      }
    }


    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Sản phẩm không tồn tại." });

    // Xử lý ảnh đại diện
    if (req.files?.image?.[0]) {
      const newImage = getImageUrl(req.files.image[0]);
      updateData.image = newImage;

      if (useCloudinary && product.image?.includes("res.cloudinary.com")) {
        try {
          const publicId = extractPublicId(product.image);
          await cloudinary.uploader.destroy(publicId);
        } catch (err) {
          console.error("Không thể xoá ảnh đại diện cũ:", err.message);
        }
      }
    } else if (req.body.imageMode === "keep") {
      updateData.image = product.image;
    } else {
      updateData.image = "";
    }

    // Xử lý ảnh bổ sung
    let updatedImages = product.images || [];

    // Xoá ảnh cũ
    if (req.body.imagesToRemove) {
      let imagesToRemove = [];
      try {
        imagesToRemove = JSON.parse(req.body.imagesToRemove);
      } catch {
        return res.status(400).json({ message: "imagesToRemove không hợp lệ." });
      }

      updatedImages = updatedImages.filter((img) => !imagesToRemove.includes(img));

      if (useCloudinary) {
        for (const imgUrl of imagesToRemove) {
          try {
            const publicId = extractPublicId(imgUrl);
            await cloudinary.uploader.destroy(publicId);
          } catch (err) {
            console.error("Không thể xoá ảnh:", err.message);
          }
        }
      }
    }

    // Thêm ảnh mới nếu có
    if (req.files?.images?.length > 0) {
      const newImages = req.files.images.map((file) => getImageUrl(file));
      if (req.body.imagesMode === "append") {
        updatedImages = [...updatedImages, ...newImages];
      } else {
        updatedImages = newImages;
      }
    }

    updateData.images = updatedImages;

    const updated = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    });

    res.json(updated);
  } catch (err) {
    console.error("Lỗi cập nhật sản phẩm:", err);
    res.status(500).json({ message: "Không thể cập nhật sản phẩm." });
  }
};

// Xoá sản phẩm
exports.deleteProduct = async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Đã xoá sản phẩm" });
  } catch (err) {
    console.error("Lỗi khi xoá sản phẩm:", err);
    res.status(400).json({ message: "Không thể xoá sản phẩm" });
  }
};

exports.toggleFeatured = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "ID sản phẩm không hợp lệ." });
  }

  try {
    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Không tìm thấy sản phẩm." });

    product.is_featured = !product.is_featured;
    await product.save();

    res.json({ message: "Cập nhật trạng thái nổi bật thành công.", is_featured: product.is_featured });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi server." });
  }
};
// Lấy sản phẩm liên quan theo category (loại trừ sản phẩm hiện tại)
exports.getRelatedProductsByCategory = async (req, res) => {
  const { category, exclude } = req.query;

  try {
    const products = await Product.find({
      category,
      _id: { $ne: exclude },
    }).limit(8);

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: "Lỗi khi lấy sản phẩm liên quan" });
  }
};

