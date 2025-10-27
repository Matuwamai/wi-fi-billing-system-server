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


export const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, durationType, durationValue, price, description } = req.body;
    const plan = await prisma.plan.update({
      where: { id: parseInt(id) },
      data: { name, durationType, durationValue, price, description },
    });
    res.json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
};

export const deletePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.plan.delete({
      where: { id: parseInt(id) },
    });
    res.json({ success: true, message: "Plan deleted successfully" });
  } catch (error) {
    next(error);
  }
};
export const getPlanById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const plan = await prisma.plan.findUnique({
      where: { id: parseInt(id) },
    });
    if (!plan) {
      return res.status(404).json({ success: false, message: "Plan not found" });
    }
    res.json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
};