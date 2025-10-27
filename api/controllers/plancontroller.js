import prisma from "../config/db.js";

export const getPlans = async (req, res, next) => {
  try {
    const plans = await prisma.plan.findMany();
    res.json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
};

export const createPlan = async (req, res, next) => {
  try {
    const { name, durationType, durationValue, price, description } = req.body;
    const plan = await prisma.plan.create({
      data: { name, durationType, durationValue, price, description },
    });
    res.status(201).json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
};
