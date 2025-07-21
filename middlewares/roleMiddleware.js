module.exports = function checkRole(requiredRoles = []) {
    return (req, res, next) => {
      const userRole = req.user?.role;
      if (!requiredRoles.includes(userRole)) {
        return res.status(403).json({ success: false, message: 'Access denied. Insufficient privileges.' });
      }
      next();
    };
};
  
  