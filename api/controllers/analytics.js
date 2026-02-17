// controllers/analyticsController.js
import prisma from "../config/db.js";
import logger from "../utils/logger.js";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const startOf = {
  today: () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  },
  week: () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  },
  month: () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  },
};

// ─────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────

/**
 * GET /api/analytics/dashboard
 * High-level overview for admin dashboard
 */
export const getDashboardAnalytics = async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalSubscriptions,
      activeSubscriptions,
      totalPayments,
      revenueAll,
      revenueToday,
      revenueWeek,
      revenueMonth,
      totalVouchers,
      usedVouchers,
      unusedVouchers,
      activeSessions,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: { subscriptions: { some: { status: "ACTIVE" } } },
      }),
      prisma.subscription.count(),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.payment.count(),
      prisma.payment.aggregate({
        where: { status: "SUCCESS" },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { status: "SUCCESS", transactionDate: { gte: startOf.today() } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { status: "SUCCESS", transactionDate: { gte: startOf.week() } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { status: "SUCCESS", transactionDate: { gte: startOf.month() } },
        _sum: { amount: true },
      }),
      prisma.voucher.count(),
      prisma.voucher.count({ where: { status: "USED" } }),
      prisma.voucher.count({ where: { status: "UNUSED" } }),
      // Active RADIUS sessions
      prisma.radAcct.count({ where: { acctstoptime: null } }),
    ]);

    return res.status(200).json({
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
          unusedVouchers,
          activeSessions, // live connected users
        },
        revenue: {
          total: revenueAll._sum.amount || 0,
          today: revenueToday._sum.amount || 0,
          week: revenueWeek._sum.amount || 0,
          month: revenueMonth._sum.amount || 0,
        },
        rates: {
          activeUserRate:
            totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : 0,
          subscriptionActiveRate:
            totalSubscriptions > 0
              ? ((activeSubscriptions / totalSubscriptions) * 100).toFixed(1)
              : 0,
          voucherRedemptionRate:
            totalVouchers > 0
              ? ((usedVouchers / totalVouchers) * 100).toFixed(1)
              : 0,
        },
      },
    });
  } catch (error) {
    logger.error(`❌ getDashboardAnalytics: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch dashboard analytics" });
  }
};

/**
 * GET /api/analytics/revenue?period=daily|weekly|monthly
 * Revenue trend — uses MySQL DATE_FORMAT instead of PostgreSQL DATE_TRUNC
 */
export const getRevenueTrends = async (req, res) => {
  try {
    const { period = "monthly" } = req.query;

    const now = new Date();
    let startDate;
    let dateFormat;

    switch (period) {
      case "daily":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 30);
        dateFormat = "%Y-%m-%d";
        break;
      case "weekly":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 90);
        dateFormat = "%x-%v"; // ISO year + week number
        break;
      case "monthly":
      default:
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        dateFormat = "%Y-%m";
    }

    // MySQL-compatible raw query
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        DATE_FORMAT(transactionDate, '${dateFormat}') AS period,
        COUNT(*)           AS transaction_count,
        SUM(amount)        AS total_revenue,
        AVG(amount)        AS avg_transaction
      FROM Payment
      WHERE status = 'SUCCESS'
        AND transactionDate >= ?
      GROUP BY DATE_FORMAT(transactionDate, '${dateFormat}')
      ORDER BY MIN(transactionDate) ASC
    `,
      startDate,
    );

    const data = rows.map((r) => ({
      period: r.period,
      transactionCount: Number(r.transaction_count),
      totalRevenue: parseFloat(r.total_revenue) || 0,
      avgTransaction: parseFloat(r.avg_transaction) || 0,
    }));

    return res.status(200).json({ success: true, period, data });
  } catch (error) {
    logger.error(`❌ getRevenueTrends: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch revenue trends" });
  }
};

/**
 * GET /api/analytics/subscriptions
 * Subscription breakdown by status and plan
 */
export const getSubscriptionAnalytics = async (req, res) => {
  try {
    const [statusDistribution, planDistribution] = await Promise.all([
      prisma.subscription.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
      prisma.subscription.groupBy({
        by: ["planId"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
    ]);

    // Enrich plan distribution with plan names
    const plans = await prisma.plan.findMany({
      where: { id: { in: planDistribution.map((p) => p.planId) } },
    });
    const planMap = Object.fromEntries(plans.map((p) => [p.id, p]));

    const enrichedPlans = planDistribution.map((item) => {
      const plan = planMap[item.planId] || {};
      return {
        planId: item.planId,
        planName: plan.name || "Unknown",
        price: plan.price || 0,
        duration: `${plan.durationValue} ${plan.durationType?.toLowerCase() || ""}`,
        count: item._count.id,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        statusDistribution: statusDistribution.map((s) => ({
          status: s.status,
          count: s._count.id,
        })),
        planDistribution: enrichedPlans,
      },
    });
  } catch (error) {
    logger.error(`❌ getSubscriptionAnalytics: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription analytics",
    });
  }
};

/**
 * GET /api/analytics/users/growth?period=monthly
 * User registration growth — MySQL-compatible
 */
export const getUserGrowth = async (req, res) => {
  try {
    const { period = "monthly" } = req.query;

    const now = new Date();
    const startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const fmt = period === "daily" ? "%Y-%m-%d" : "%Y-%m";

    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        DATE_FORMAT(createdAt, '${fmt}')                    AS period,
        COUNT(*)                                             AS new_users,
        SUM(CASE WHEN isGuest = 1 THEN 1 ELSE 0 END)        AS guest_users,
        SUM(CASE WHEN isGuest = 0 THEN 1 ELSE 0 END)        AS registered_users
      FROM User
      WHERE createdAt >= ?
      GROUP BY DATE_FORMAT(createdAt, '${fmt}')
      ORDER BY MIN(createdAt) ASC
    `,
      startDate,
    );

    let cumulative = 0;
    const data = rows.map((r) => {
      cumulative += Number(r.new_users);
      return {
        period: r.period,
        newUsers: Number(r.new_users),
        guestUsers: Number(r.guest_users),
        registeredUsers: Number(r.registered_users),
        cumulative,
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error(`❌ getUserGrowth: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch user growth" });
  }
};

/**
 * GET /api/analytics/plans/top
 * Top-performing plans by subscriptions & revenue
 */
export const getTopPlans = async (req, res) => {
  try {
    // Prisma groupBy approach (no raw SQL needed)
    const planStats = await prisma.subscription.groupBy({
      by: ["planId"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    });

    const plans = await prisma.plan.findMany({
      where: { id: { in: planStats.map((p) => p.planId) } },
    });
    const planMap = Object.fromEntries(plans.map((p) => [p.id, p]));

    // Get revenue per plan
    const revenueByPlan = await prisma.payment.groupBy({
      by: ["planId"],
      where: {
        status: "SUCCESS",
        planId: { in: planStats.map((p) => p.planId) },
      },
      _sum: { amount: true },
    });
    const revenueMap = Object.fromEntries(
      revenueByPlan.map((r) => [r.planId, r._sum.amount || 0]),
    );

    const data = planStats.map((item) => {
      const plan = planMap[item.planId] || {};
      return {
        planId: item.planId,
        name: plan.name || "Unknown",
        price: plan.price || 0,
        duration: `${plan.durationValue} ${plan.durationType?.toLowerCase() || ""}`,
        rateLimit: plan.rateLimit || "10M/10M",
        subscriptionCount: item._count.id,
        totalRevenue: revenueMap[item.planId] || 0,
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error(`❌ getTopPlans: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch top plans" });
  }
};

/**
 * GET /api/analytics/payments/methods
 * Payment method & status breakdown
 */
export const getPaymentMethodsAnalytics = async (req, res) => {
  try {
    const [byMethod, byStatus] = await Promise.all([
      prisma.payment.groupBy({
        by: ["method"],
        _count: { id: true },
        _sum: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ["status"],
        _count: { id: true },
        _sum: { amount: true },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        byMethod: byMethod.map((m) => ({
          method: m.method,
          count: m._count.id,
          total: m._sum.amount || 0,
        })),
        byStatus: byStatus.map((s) => ({
          status: s.status,
          count: s._count.id,
          total: s._sum.amount || 0,
        })),
      },
    });
  } catch (error) {
    logger.error(`❌ getPaymentMethodsAnalytics: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch payment analytics" });
  }
};

/**
 * GET /api/analytics/radius
 * RADIUS-specific stats: data usage, top users, session counts
 */
export const getRadiusAnalytics = async (req, res) => {
  try {
    const [totalSessions, activeSessions, topUsersByData] = await Promise.all([
      prisma.radAcct.count(),
      prisma.radAcct.count({ where: { acctstoptime: null } }),
      // Top 10 users by total data usage
      prisma.radAcct.groupBy({
        by: ["username"],
        _sum: { acctinputoctets: true, acctoutputoctets: true },
        _count: { radacctid: true },
        orderBy: { _sum: { acctoutputoctets: "desc" } },
        take: 10,
      }),
    ]);

    const topUsers = topUsersByData.map((u) => {
      const totalBytes =
        Number(u._sum.acctinputoctets || 0) +
        Number(u._sum.acctoutputoctets || 0);
      return {
        username: u.username,
        sessions: u._count.radacctid,
        totalMB: (totalBytes / 1048576).toFixed(2),
        totalGB: (totalBytes / 1073741824).toFixed(3),
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        totalSessions,
        activeSessions,
        topUsers,
      },
    });
  } catch (error) {
    logger.error(`❌ getRadiusAnalytics: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch RADIUS analytics" });
  }
};
