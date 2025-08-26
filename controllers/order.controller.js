const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const Notification = require("../models/Notification");


exports.createCashOrder = async (req, res) => {
  try {
    const {
      items,
      address,
      shipping_fee,
      payment_method = 'cash',
      total_amount
    } = req.body;

    const user_id = req.user?.userId;
    if (!user_id) {
      return res.status(401).json({ message: 'Người dùng chưa được xác thực.' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Danh sách sản phẩm không hợp lệ.' });
    }

    for (const item of items) {
      const { product_id, color, size, quantity, price } = item;
      if (!product_id || !color || !size || !quantity || !price) {
        return res.status(400).json({
          message: 'Mỗi sản phẩm phải có đủ: product_id, color, size, quantity, price.'
        });
      }

      const product = await Product.findById(product_id);
      if (!product) {
        return res.status(404).json({ message: `Không tìm thấy sản phẩm.` });
      }

      const variant = product.variations.find(
        (v) => v.color === color && v.size === size
      );

      if (!variant || variant.quantity < quantity) {
        return res.status(400).json({
          message: `Sản phẩm ${product.name} (${color} - ${size}) không đủ hàng trong kho.`
        });
      }
    }

    if (
      !address ||
      !address.full_name ||
      !address.phone_number ||
      !address.province ||
      !address.district ||
      !address.ward ||
      !address.street
    ) {
      return res.status(400).json({ message: 'Địa chỉ giao hàng không đầy đủ.' });
    }

    if (typeof shipping_fee !== 'number' || typeof total_amount !== 'number') {
      return res.status(400).json({ message: 'shipping_fee và total_amount phải là số.' });
    }

    const order = new Order({
      user_id,
      items,
      address,
      shipping_fee,
      payment_method,
      total_amount,
      status: 'pending',
      payment_info: {}
    });

    const savedOrder = await order.save();

    res.status(201).json(savedOrder);
  } catch (error) {
    console.error('Lỗi khi tạo đơn hàng thanh toán tiền mặt:', error);
    res.status(500).json({ message: 'Tạo đơn hàng thất bại.' });
  }
};
// Lấy danh sách đơn hàng của chính người dùng
exports.getMyOrders = async (req, res) => {
  try {
    const userId = req.user.userId;

    const orders = await Order.find({ user_id: userId }).sort({ createdAt: -1 });

    res.status(200).json(orders);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách đơn hàng:", error);
    res.status(500).json({ message: "Không thể lấy danh sách đơn hàng." });
  }
};
//chi tiết đơn hàng
exports.getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id)
      .populate('user_id', 'full_name email')
      .populate('items.product_id', 'name image price')


    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    // Chỉ admin hoặc chính chủ mới xem được
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && order.user_id._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Bạn không có quyền xem đơn hàng này.' });
    }

    res.status(200).json(order);
  } catch (error) {
    console.error('Lỗi khi lấy chi tiết đơn hàng:', error);
    res.status(500).json({ message: 'Không thể lấy chi tiết đơn hàng.' });
  }
};

// Cập nhật trạng thái
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status: newStatus } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng." });
    }

    const currentStatus = order.status;

    const validTransitions = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['processing', 'cancelled'],
      processing: ['shipping', 'cancelled'],
      shipping: ['delivered'],
    };

    if (['delivered', 'cancelled'].includes(currentStatus)) {
      return res.status(400).json({ message: "Đơn hàng đã hoàn tất hoặc đã bị hủy, không thể cập nhật." });
    }

    const allowedNextStatuses = validTransitions[currentStatus] || [];

    if (!allowedNextStatuses.includes(newStatus)) {
      return res.status(400).json({
        message: `Không thể chuyển trạng thái từ "${currentStatus}" sang "${newStatus}". Trạng thái hợp lệ tiếp theo: ${allowedNextStatuses.join(', ')}.`
      });
    }

    // Trừ kho khi chuyển sang "confirmed"
    if (currentStatus === 'pending' && newStatus === 'confirmed') {
      const Product = require('../models/Product');

      for (const item of order.items) {
        const product = await Product.findById(item.product_id);
        if (!product) continue;

        const variant = product.variations.find(
          (v) => v.color === item.color && v.size === item.size
        );

        if (!variant || variant.quantity < item.quantity) {
          return res.status(400).json({ message: `Sản phẩm ${item.name} không đủ hàng.` });
        }

        variant.quantity -= item.quantity;
        product.quantity -= item.quantity;
        await product.save();
      }
    }

    order.status = newStatus;
    await order.save();

    // Gửi WebSocket cập nhật
    const io = req.app.get("io");
    if (io) {
      io.to(order.user_id.toString()).emit("orderStatusUpdated", {
        orderId: order._id,
        newStatus: order.status,
        updatedAt: order.updatedAt,
      });
    }
    await Notification.create({
      user_id: order.user_id,
      type: "order",
      title: "Cập nhật đơn hàng",
      message: `Đơn hàng #${order._id.toString().slice(-6)} đã chuyển sang trạng thái: ${order.status}`,
      order_id: order._id,
      image: order.items[0]?.image || null,
      productName: order.items[0]?.name || "",
      read: false,
    });

    res.status(200).json({
      message: "Cập nhật trạng thái đơn hàng thành công.",
      order
    });
  } catch (error) {
    console.error("Lỗi cập nhật trạng thái đơn hàng:", error);
    res.status(500).json({ message: "Cập nhật thất bại." });
  }
};



// Lấy danh sách tất cả đơn hàng (dành cho admin)
exports.getAllOrders = async (req, res) => {
  try {
    const { status, sort } = req.query;

    const filter = {};

    // Lọc theo status nếu có
    if (status && ['pending', 'confirmed', 'processing', 'shipping', 'delivered', 'cancelled'].includes(status)) {
      filter.status = status;
    }

    // Xác định hướng sắp xếp
    const sortOption = sort === 'asc' ? 1 : -1;

    console.log(' Đang lấy danh sách đơn hàng với filter:', filter);

    const orders = await Order.find(filter)
      .populate('user_id', 'full_name email') // Lấy tên/email khách hàng
      .populate('items.product_id', 'name')   // lấy tên sản phẩm
      .sort({ createdAt: sortOption })
      .lean();

    console.log(` Đã tìm được ${orders.length} đơn hàng.`);
    res.status(200).json(orders);
  } catch (error) {
    console.error(' Lỗi khi lấy danh sách đơn hàng admin:', error);
    res.status(500).json({ message: 'Không thể tải danh sách đơn hàng.' });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng." });
    }

    // Không cho hủy nếu đã giao hoặc đã hủy
    if (['delivered', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ message: "Đơn hàng không thể hủy." });
    }

    const userId = req.user.userId;
    const isAdmin = req.user.role === 'admin';

    // Kiểm tra quyền hủy
    if (!isAdmin && order.user_id.toString() !== userId) {
      return res.status(403).json({ message: "Bạn không có quyền hủy đơn hàng này." });
    }

    // Người dùng thường chỉ được hủy khi pending
    if (!isAdmin && order.status !== 'pending') {
      return res.status(403).json({ message: "Bạn chỉ có thể hủy đơn hàng khi đang chờ xác nhận." });
    }

    // ===== Cộng lại kho =====
    // Admin chỉ cộng lại kho khi trạng thái KHÁC pending
    // User chỉ hủy khi pending nên sẽ không bao giờ cộng lại kho
    if (isAdmin) {
      if (Array.isArray(order.items)) {
        for (const item of order.items) {
          const product = await Product.findById(item.product_id);
          if (product && Array.isArray(product.variations)) {
            const variation = product.variations.find(
              v => v.color === item.color && v.size === item.size
            );

            if (variation) {
              variation.quantity += item.quantity;
            } else {
              console.warn(`Không tìm thấy biến thể: ${item.color}, ${item.size} cho sản phẩm ${item.product_id}`);
            }

            await product.save();
          } else {
            console.warn(`Không tìm thấy sản phẩm hoặc variations không hợp lệ: ${item.product_id}`);
          }
        }
      }
    }

    // ===== Cập nhật trạng thái đơn hàng =====
    order.status = 'cancelled';
    await order.save();

    // ===== Gửi event realtime nếu có =====
    const io = req.app.get("io");
    if (io) {
      io.to(order.user_id.toString()).emit("orderStatusUpdated", {
        orderId: order._id,
        newStatus: order.status,
        updatedAt: order.updatedAt,
      });
    }
    await Notification.create({
      user_id: order.user_id,
      type: "order",
      title: "Cập nhật đơn hàng",
      message: `Đơn hàng #${order._id.toString().slice(-6)} đã bị hủy.`,
      order_id: order._id,
      image: order.items[0]?.image || null, // lấy ảnh sản phẩm đầu tiên
      productName: order.items[0]?.name || "",
      read: false,
    });



    res.status(200).json({
      message: 'Đơn hàng đã được hủy.',
      order
    });
  } catch (error) {
    console.error('Lỗi khi huỷ đơn hàng:', error);
    res.status(500).json({ message: 'Không thể hủy đơn hàng.' });
  }
};



// Thêm function tạo đơn hàng VNPay
exports.createVNPayOrder = async (req, res) => {
  try {
    const {
      items,
      address,
      shipping_fee,
      total_amount
    } = req.body;

    const user_id = req.user?.userId;
    if (!user_id) {
      return res.status(401).json({ message: 'Người dùng chưa được xác thực.' });
    }

    // Kiểm tra thông tin đầu vào
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Danh sách sản phẩm không hợp lệ.' });
    }

    for (const item of items) {
      const { product_id, color, size, quantity, price } = item;
      if (!product_id || !color || !size || !quantity || !price) {
        return res.status(400).json({
          message: 'Mỗi sản phẩm phải có đủ: product_id, color, size, quantity, price.'
        });
      }
    }

    if (
      !address ||
      !address.full_name ||
      !address.phone_number ||
      !address.province ||
      !address.district ||
      !address.ward ||
      !address.street
    ) {
      return res.status(400).json({ message: 'Địa chỉ giao hàng không đầy đủ.' });
    }

    if (typeof shipping_fee !== 'number' || typeof total_amount !== 'number') {
      return res.status(400).json({ message: 'shipping_fee và total_amount phải là số.' });
    }

    // Tạo đơn hàng với payment_method = 'vnpay'
    const order = new Order({
      user_id,
      items,
      address,
      shipping_fee,
      payment_method: 'vnpay',
      total_amount,
      status: 'pending',
      payment_info: {}
    });

    const savedOrder = await order.save();

    res.status(201).json(savedOrder);
  } catch (error) {
    console.error('Lỗi khi tạo đơn hàng VNPay:', error);
    res.status(500).json({ message: 'Tạo đơn hàng thất bại.' });
  }
};