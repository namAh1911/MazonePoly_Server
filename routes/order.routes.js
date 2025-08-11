const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const authAdmin = require("../middleware/authAdmin");
const orderController = require('../controllers/order.controller');

// Đặt hàng VNPay
router.post("/vnpay-order", auth, orderController.createVNPayOrder);

// Đặt hàng COD
router.post('/cash-order', auth, orderController.createCashOrder);

// Lấy đơn hàng của user
router.get('/my-orders', auth, orderController.getMyOrders);

// Lấy danh sách tất cả đơn hàng cho admin
router.get('/admin/orders', authAdmin, orderController.getAllOrders);

// Lấy chi tiết đơn hàng
router.get('/:id', auth, orderController.getOrderById);

// Admin cập nhật trạng thái đơn hàng
router.put('/:id/status', authAdmin, orderController.updateOrderStatus);

// Hủy đơn hàng (User chỉ hủy được đơn của mình khi pending, Admin hủy được nhiều trạng thái hơn)
router.put('/:id/cancel', auth, orderController.cancelOrder);



module.exports = router;
