// controllers/analyticsController.js
import prisma from "../config/db.js";

// Get dashboard overview
export const getDashboardAnalytics = async (req, res) => {
  try {
    const today = new Date();
    const startOfToday = new Date(today.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(today.setDate(today.getDate() - 7));
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Get total users
    const totalUsers = await prisma.user.count();

    // Get active users (users with active subscriptions)
    const activeUsers = await prisma.user.count({
      where: {
        subscriptions: {
          some: {
            status: "ACTIVE",
          },
        },
      },
    });

    // Get total subscriptions
    const totalSubscriptions = await prisma.subscription.count();

    // Get active subscriptions
    const activeSubscriptions = await prisma.subscription.count({
      where: { status: "ACTIVE" },
    });

    // Get total payments
    const totalPayments = await prisma.payment.count();

    // Get total revenue
    const revenueResult = await prisma.payment.aggregate({
      where: { status: "SUCCESS" },
      _sum: { amount: true },
    });
    const totalRevenue = revenueResult._sum.amount || 0;

    // Get today's revenue
    const todayRevenueResult = await prisma.payment.aggregate({
      where: {
        status: "SUCCESS",
        transactionDate: { gte: startOfToday },
      },
      _sum: { amount: true },
    });
    const todayRevenue = todayRevenueResult._sum.amount || 0;

    // Get this week's revenue
    const weekRevenueResult = await prisma.payment.aggregate({
      where: {
        status: "SUCCESS",
        transactionDate: { gte: startOfWeek },
      },
      _sum: { amount: true },
    });
    const weekRevenue = weekRevenueResult._sum.amount || 0;

    // Get this month's revenue
    const monthRevenueResult = await prisma.payment.aggregate({
      where: {
        status: "SUCCESS",
        transactionDate: { gte: startOfMonth },
      },
      _sum: { amount: true },
    });
    const monthRevenue = monthRevenueResult._sum.amount || 0;

    // Get voucher statistics
    const totalVouchers = await prisma.voucher.count();
    const usedVouchers = await prisma.voucher.count({
      where: { status: "USED" },
    });
    const availableVouchers = await prisma.voucher.count({
      where: { status: "UNUSED" },
    });

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalUsers,
          activeUsers,
          totalSubscriptions,
          activeSubscriptions,
          totalPayments,
          totalVouchers,
          usedVouchers,
          availableVouchers,
        },
        revenue: {
          total: totalRevenue,
          today: todayRevenue,
          week: weekRevenue,
          month: monthRevenue,
        },
        growthMetrics: {
          userGrowthRate: totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0,
          subscriptionUtilization:
            totalSubscriptions > 0
              ? (activeSubscriptions / totalSubscriptions) * 100
              : 0,
          voucherUtilization:
            totalVouchers > 0 ? (usedVouchers / totalVouchers) * 100 : 0,
        },
      },
    });
  } catch (error) {
    console.error("Dashboard analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard analytics",
      error: error.message,
    });
  }
};

// Get revenue trends
export const getRevenueTrends = async (req, res) => {
  try {
    const { period = "monthly" } = req.query;
    const now = new Date();
    let startDate,
      endDate = now;
    let interval;

    switch (period) {
      case "daily":
        startDate = new Date(now.setDate(now.getDate() - 30));
        interval = "day";
        break;
      case "weekly":
        startDate = new Date(now.setDate(now.getDate() - 90));
        interval = "week";
        break;
      case "monthly":
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        interval = "month";
        break;
      default:
        startDate = new Date(now.setDate(now.getDate() - 30));
        interval = "day";
    }

    // Get revenue data grouped by time interval
    const revenueData = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC(${interval}, "transactionDate") as period,
        COUNT(*) as transaction_count,
        SUM(amount) as total_revenue,
        AVG(amount) as average_transaction
      FROM "Payment"
      WHERE status = 'SUCCESS'
        AND "transactionDate" >= ${startDate}
        AND "transactionDate" <= ${endDate}
      GROUP BY DATE_TRUNC(${interval}, "transactionDate")
      ORDER BY period ASC
    `;

    // Format the data
    const formattedData = revenueData.map((item) => ({
      period: new Date(item.period).toLocaleDateString("en-US", {
        month: "short",
        day: period === "monthly" ? undefined : "numeric",
        year: "2-digit",
      }),
      transactionCount: parseInt(item.transaction_count),
      totalRevenue: parseFloat(item.total_revenue) || 0,
      averageTransaction: parseFloat(item.average_transaction) || 0,
    }));

    res.status(200).json({
      success: true,
      period,
      data: formattedData,
    });
  } catch (error) {
    console.error("Revenue trends error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch revenue trends",
      error: error.message,
    });
  }
};

// Get subscription analytics
export const getSubscriptionAnalytics = async (req, res) => {
  try {
    // Get subscription status distribution
    const statusDistribution = await prisma.subscription.groupBy({
      by: ["status"],
      _count: true,
    });

    // Get subscriptions by plan
    const planDistribution = await prisma.subscription.groupBy({
      by: ["planId"],
      _count: true,
      orderBy: {
        _count: { id: "desc" },
      },
      take: 10,
    });

    // Get plan details
    const planDetails = await Promise.all(
      planDistribution.map(async (item) => {
        const plan = await prisma.plan.findUnique({
          where: { id: item.planId },
          select: {
            name: true,
            price: true,
            durationType: true,
            durationValue: true,
          },
        });
        return {
          planId: item.planId,
          planName: plan?.name || "Unknown",
          count: item._count,
          price: plan?.price || 0,
          duration: `${plan?.durationValue} ${
            plan?.durationType?.toLowerCase() || "unknown"
          }`,
        };
      })
    );

    // Get subscription duration statistics
    const durationStats = await prisma.$queryRaw`
      SELECT 
        AVG(EXTRACT(EPOCH FROM ("endTime" - "startTime"))/3600) as avg_hours,
        MAX(EXTRACT(EPOCH FROM ("endTime" - "startTime"))/3600) as max_hours,
        MIN(EXTRACT(EPOCH FROM ("endTime" - "startTime"))/3600) as min_hours
      FROM "Subscription"
      WHERE status = 'ACTIVE'
    `;

    res.status(200).json({
      success: true,
      data: {
        statusDistribution,
        planDistribution: planDetails,
        durationStats: durationStats[0],
        totalActive:
          statusDistribution.find((s) => s.status === "ACTIVE")?._count || 0,
        totalExpired:
          statusDistribution.find((s) => s.status === "EXPIRED")?._count || 0,
        totalCanceled:
          statusDistribution.find((s) => s.status === "CANCELED")?._count || 0,
      },
    });
  } catch (error) {
    console.error("Subscription analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subscription analytics",
      error: error.message,
    });
  }
};

// Get user growth data
export const getUserGrowth = async (req, res) => {
  try {
    const { period = "monthly" } = req.query;
    const now = new Date();
    const startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);

    // Get user growth data
    const growthData = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC(${period}, "createdAt") as period,
        COUNT(*) as new_users,
        SUM(CASE WHEN "isGuest" = true THEN 1 ELSE 0 END) as guest_users,
        SUM(CASE WHEN "isGuest" = false THEN 1 ELSE 0 END) as registered_users
      FROM "User"
      WHERE "createdAt" >= ${startDate}
      GROUP BY DATE_TRUNC(${period}, "createdAt")
      ORDER BY period ASC
    `;

    // Calculate cumulative growth
    let cumulativeTotal = 0;
    const formattedData = growthData.map((item) => {
      cumulativeTotal += parseInt(item.new_users);
      return {
        period: new Date(item.period).toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        newUsers: parseInt(item.new_users),
        guestUsers: parseInt(item.guest_users),
        registeredUsers: parseInt(item.registered_users),
        cumulativeTotal,
      };
    });

    res.status(200).json({
      success: true,
      data: formattedData,
    });
  } catch (error) {
    console.error("User growth error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user growth data",
      error: error.message,
    });
  }
};

// Get top performing plans
export const getTopPlans = async (req, res) => {
  try {
    const topPlans = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.name,
        p.price,
        p.duration_type as "durationType",
        p.duration_value as "durationValue",
        COUNT(s.id) as subscription_count,
        SUM(CASE WHEN s.status = 'ACTIVE' THEN 1 ELSE 0 END) as active_count,
        SUM(p2.amount) as total_revenue
      FROM "Plan" p
      LEFT JOIN "Subscription" s ON p.id = s."planId"
      LEFT JOIN "Payment" p2 ON s."paymentId" = p2.id AND p2.status = 'SUCCESS'
      GROUP BY p.id, p.name, p.price, p.duration_type, p.duration_value
      ORDER BY subscription_count DESC, total_revenue DESC
      LIMIT 10
    `;

    res.status(200).json({
      success: true,
      data: topPlans,
    });
  } catch (error) {
    console.error("Top plans error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch top plans",
      error: error.message,
    });
  }
};

// Get payment methods analytics
export const getPaymentMethodsAnalytics = async (req, res) => {
  try {
    const paymentMethods = await prisma.payment.groupBy({
      by: ["method"],
      _count: true,
      _sum: { amount: true },
    });

    const statusDistribution = await prisma.payment.groupBy({
      by: ["status"],
      _count: true,
      _sum: { amount: true },
    });

    res.status(200).json({
      success: true,
      data: {
        paymentMethods,
        statusDistribution,
      },
    });
  } catch (error) {
    console.error("Payment methods analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment methods analytics",
      error: error.message,
    });
  }
};

// Get user device statistics
export const getUserDeviceStats = async (req, res) => {
  try {
    const deviceStats = await prisma.user.groupBy({
      by: ["deviceName"],
      _count: true,
      where: {
        deviceName: { not: null },
      },
      orderBy: {
        _count: { id: "desc" },
      },
      take: 10,
    });

    const guestVsRegistered = await prisma.user.groupBy({
      by: ["isGuest"],
      _count: true,
    });

    res.status(200).json({
      success: true,
      data: {
        deviceStats,
        guestVsRegistered,
      },
    });
  } catch (error) {
    console.error("User device stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user device statistics",
      error: error.message,
    });
  }
};
